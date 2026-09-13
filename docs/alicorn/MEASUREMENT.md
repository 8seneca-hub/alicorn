# Alicorn — Success measurement

> **Status: DRAFT PROTOCOL — NOT AGREED.** Every threshold below is a _proposal for sign-off_.
> Nothing here is decided until §10 is filled in, signed and committed. Until then this document
> describes how we would measure, not what we have concluded. **Do not cite any number in this
> document as a result.**

**Plane:** SM1 (ALC-87) · **Source:** [PROJECT-BRIEF](PROJECT-BRIEF.md) §11.7, decision 7 accepted
2026-09-06 · **Depends on:** M1 (Done), FM3 (Done) · **Written:** 2026-09-08

---

## 01 · Why this document exists

Alicorn currently borrows its economic case. The figure in [CLAUDE.md](../../CLAUDE.md) — _roughly
90% better results for ~15× the tokens_ — comes from published multi-agent research on **research
tasks**, not on shipping features, and not on this repository. The brief says so twice, once as a
decision and once as a risk:

> **We have no evidence a team of agents beats one agent on our work.** […] Until we measure on our
> own tickets the economic case is borrowed, not ours. This is the strongest argument for keeping
> single-agent the default. — PROJECT-BRIEF §12

SM1's job is to stop borrowing that number. Not to confirm it — to replace it with one of ours,
whichever direction it points.

**The integrity mechanism is the ordering, not the arithmetic.** A threshold agreed after the run is
not a threshold, it is a story. So the threshold is registered in writing, in a commit, before the
first dispatch of either arm — and that ordering is machine-checkable, because the ledger's
`created_at` is server time and the registration is a git commit (§09).

---

## 02 · What we already measure — M1 as shipped

The protocol builds on what exists. These are the real fields and the real command, verified against
the code on 2026-09-08 and re-verified after LG5 (ALC-105) on the same day; do not invent metric
names beside them.

**Command.** `orca ledger report [--stage <key>] [--project <id>] [--member <id>] [--run <id>]
[--strategy <single|orchestrated>] [--since <iso>] [--until <iso>] [--json]` —
`src/cli/specs/ledger.ts`, handler
`src/cli/handlers/ledger/report-handlers.ts`. The binary renames to `alicorn` with R1–R5; the
subcommand path does not change.

**Payload** — `InterruptionsReport` in `src/shared/alicorn/ledger-report.ts`, computed by
`getInterruptionsReport` in `cloud/apps/ledger-api/src/interruptions-repository.ts`:

| Field                     | Meaning as computed                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completedTaskDefinition` | Which rule produced `completedTasks`. Today always `any_successful_step`; `terminal_stage_succeeded` and `no_failed_step_outstanding` are declared in the contract but not implemented.        |
| `completedTasks`          | `COUNT(DISTINCT task_id)` over `step_outcomes` matching the filters **and `outcome = 'succeeded'`**. A task whose every step failed is not counted.                                            |
| `tasksTouched`            | The same count with no `outcome` condition — every task with a settled outcome, failures included. This is what `completedTasks` used to mean.                                                 |
| `interruptions`           | `COUNT(DISTINCT i.id)` over `step_interruptions` joined to those outcomes on `(tenant, task, dispatch)`. `DISTINCT` deliberately, so a v1.5 multi-dispatch task cannot inflate the north star. |
| `perCompletedTask`        | `interruptions / completedTasks`, or `0` when the denominator is zero. **The north-star metric.**                                                                                              |
| `perTaskTouched`          | `interruptions / tasksTouched`. The loose figure, reported beside the strict one so a divergence is visible. It is always the smaller of the two, which is why it must never be quoted alone.  |
| `byKind`                  | Counts by `gate` \| `ask` \| `escalation`.                                                                                                                                                     |
| `byStage[]`               | The same five numbers per `stage_key`. Stage rows come from _touched_, so a stage whose every step failed still appears.                                                                       |
| `excluded`                | Always `['permission_prompt']` — permission prompts are not interruptions.                                                                                                                     |

**LG5 (ALC-105) changed what `perCompletedTask` means.** Before it, the denominator was tasks
_touched_: a failed step enlarged it, so the north star read best exactly when the system was
failing most. It is now tasks with at least one successful step — candidate (a) of three; (b)
_terminal stage succeeded_ and (c) _no failed step outstanding_ remain open and are chosen from real
data once the two printed figures have diverged on a real run. The swap point is
`completedTaskPairsSql` in `cloud/apps/ledger-api/src/interruptions-repository.ts`.

**Other ledger reads the protocol uses** (HTTP only — there is no CLI for either, see §11):

- `GET /v1/ledger/runs/:runId/cost` → `RunCost { runId, totalSpendCents, byDispatch[] }`.
- `GET /v1/ledger/provenance?repoId&branch` → `ProvenanceReport` with `outcomes`, `verifications`,
  `contextCaptures`, `totals { spendCents, tasks, dispatches }`, `reviewBackend { enforced, bypassed }`.
- `GET /v1/ledger/provenance/export?repoId&branch&format=json|md` (PV2) → the same trail as one
  dated, ES256-signed document. `format=json` returns `{ document, signature, archive }`;
  `format=md` returns the Markdown with the whole signed document attached as a compact JWS, so the
  file verifies on its own. The signature covers the RFC 8785 canonical bytes of `document` —
  every step, gate decision, gate agreement and the rendered Markdown — and the public key is at
  `GET /.well-known/alicorn-provenance-jwks.json`, unauthenticated. `503 export_not_configured`
  when no signing key is set: an unsigned audit artefact is worse than none.

**Fields on `step_outcomes` that carry experiment signal:** `execution_strategy`
(`single` \| `orchestrated`), `backend`, `spend_cents`, `usage`, `human_verdict`
(`accepted` \| `rejected` \| `amended`, written only by the corrections sweep), `amended_after_ms`,
`review_backend_bypass`, `escalation_offered`, `escalation_accepted`, `gate_decision`, `gate_reason`,
`gate_id`, `policy_recommendation`, `policy_recommendation_reason`, `human_gate_decision`,
`agreed_with_policy`, `recommendation_shown` — the last five are what let an export say whether the
human agreed with the policy, not only whether one was asked.

**Four things M1 does not tell us**, each of which the protocol has to work around rather than
assume away — the full list with proposed fixes is §11.

1. ~~The report cannot be scoped to a **run** or to an **execution strategy**.~~ **Closed by LG5.**
   Filters are now `stageKey`, `projectId`, `memberId`, `runId`, `executionStrategy`, `since`,
   `until`. `--compare-runs <a> <b>` still does not exist; two `--run` reports replace it.
2. ~~`completedTasks` counts _tasks touched_, not _tasks completed successfully_.~~ **Closed by
   LG5**, under definition (a). Both counts are now reported; which definition is right is still
   open.
3. **The ledger holds no duration.** `created_at` is server time and `client_ts` is the dispatch's
   completion; there is no start time on the row. Elapsed time comes from git and the provider API.
4. Nothing records **how long a human was engaged**. `step_interruptions` has `occurred_at` and
   `resolved_by`, but no `resolved_at`, so interruption dwell time is not derivable.

---

## 03 · The claim under test

Stated so that it can fail.

> **H₁.** On a real ticket from this backlog, `execution_strategy: orchestrated` (Foreman) reaches a
> mergeable PR with **materially fewer human interruptions** than today's default
> (`execution_strategy: single`), **without being slower in calendar time**, **without a quality
> regression**, and at a spend premium that is **smaller than the value of the human time it
> returns**.

Note what is _not_ claimed. Foreman is not claimed to be faster, and it is not claimed to be cheaper.
CLAUDE.md's framing — _multi-agent is a trade, not an upgrade_ — is the framing the experiment tests.
A Foreman arm that is 3× the spend and returns two hours of a developer's attention is a good trade.
One that is 3× the spend and returns twenty minutes is not, and we should find that out from our own
ledger.

---

## 04 · Design

### 04.1 The two arms

|                        | Arm C — **control**                                                    | Arm F — **Foreman**                                |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| Execution strategy     | `single`                                                               | `orchestrated`                                     |
| Human role             | Briefs one agent, steers it, answers its questions, reviews and merges | Briefs the lead, answers gates, reviews and merges |
| What is being given up | —                                                                      | The developer's continuous attention               |

**Arm C is a developer _with_ a single agent, not a developer typing by hand.** This matters and it
is the first sign-off item (§10.1). Alicorn already ships single-agent as the default and calls it
~90% of daily work; the alternative a user actually gives up when they choose Foreman is
single-agent, not unaided typing. Measuring against unaided typing would produce a flattering number
about a choice nobody is making.

### 04.2 Unit of observation

**One ticket, run once per arm — a _pair_.** The pair, not the run, is the unit; a single arm's
number in isolation means nothing.

### 04.3 The bias problem, and what actually controls it

The same ticket cannot be run twice by the same person: the second run inherits the first run's
understanding, and that alone is worth more than either execution strategy. Three designs are
available, in decreasing strength and increasing cost:

| Design                             | How it controls the learning effect                                                                                                                                                                     | What it costs              | What it cannot rule out                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| **A · Two operators, one ticket**  | Operator A runs arm C, operator B runs arm F, from the same written brief, in isolation — separate worktrees, separate branches, no shared chat, neither sees the other's diff before both PRs are open | Two people                 | Operator skill difference                                            |
| **B · Matched pair, one operator** | Two tickets of the same size band from the same module, arm assigned by coin flip, run in randomised order                                                                                              | One person                 | Ticket difficulty variance, which at n = 1 pair dominates everything |
| **C · Replicated matched pairs**   | Design B repeated over **n ≥ 3** pairs with arm order alternated                                                                                                                                        | One person, 3× the tickets | Less; variance starts to average out                                 |

**Recommended: design B replicated to n = 3 (i.e. design C), falling back to design A for one pair
if a second operator is available.** Reasoning: the team is one engineer
([sequencing plan, 2026-09-08](plans/2026-09-08-remaining-work-sequencing.md) — 51 open tickets, all
assigned to one person), so design A is not reliably available, and n = 1 of design B is a coin flip
dressed as evidence.

**Say plainly what this is.** Even at n = 3 with one operator, this is a **decision experiment, not
a study**. It produces a defensible basis for a product decision under stated uncertainty. It does
not produce a publishable effect size, and the result must never be written up as one — that would
be the same borrowing mistake in our own handwriting. The write-up says "on three tickets in this
repository, measured this way", every time.

### 04.4 Choosing the tickets

Registered before any run, by name and Plane key.

- **Source.** Real open ALC tickets that were going to be done anyway. Never a ticket invented for
  the experiment — Foreman's failure mode is precisely that it looks good on a synthetic brief.
- **Size band.** 0.5–2 ew, the band where escalation to `orchestrated` is plausible. Below it,
  nobody would orchestrate; above it, one pair takes a month.
- **Must be within Foreman's stated envelope.** Long-running or multi-repo — Foreman is an add-on
  for exactly that, and testing it outside its envelope tests nothing.
- **Exclusions.** No ticket the operator has already started; no ticket whose spec is still being
  argued (the experiment must not measure spec churn); no ticket that touches the measurement code
  itself.
- **Pairing rule (design B/C).** Two tickets are a pair if they share a module, a size estimate and
  a lane. Pairings are registered before the first run and are not revised afterwards.

---

## 05 · Measures

Four measures. Three are compared; the fourth is a gate that is never traded away.

### M-1 · Interruptions per completed task — _the north star_

**Source.** `orca ledger report --project <arm project id> --since <t0> --until <t_end> --json`,
field `perCompletedTask`; report `byKind` alongside it.

**Isolation.** Since LG5 the report filters by run and by execution strategy directly:
`--run <id>` maps to `o.run_id`, `--strategy single|orchestrated` to `o.execution_strategy`. Each
arm still gets **its own `project_id` and a disjoint time window** as well — belt and braces, because
a shared project id would silently merge the arms and the merge would look like a result — but the
per-arm project ids are no longer the only thing separating them.

**Denominator caveat, recorded every time.** The report now emits two denominators and both are
recorded: `completedTasks` (tasks with at least one `succeeded` outcome) and `tasksTouched` (any
settled outcome). `perCompletedTask` is the north star; `perTaskTouched` is the figure the report
used to print under that name, and it is always the flattering one. If the two disagree by more than
10%, the run is reported as inconclusive on M-1 rather than resolved in either direction — the gap
means the arms' failure rates differ enough that neither denominator settles the comparison. No
hand-computed variant is needed any more.

### M-2 · Attended time

**Definition.** Minutes the operator was engaged with the ticket: briefing, answering a gate or a
question, reviewing, or waiting on the agent while not doing anything else.

**Source.** Measured by hand — a timer started and stopped by the operator, logged per event. **The
ledger cannot supply this** (§02, item 4). `step_interruptions.occurred_at` gives the arrival time of
each interruption but not its resolution, so dwell time is not derivable.

**This is the softest primary measure in the protocol, and it is the one Foreman's whole case rests
on.** Two mitigations: log each interval at the time rather than reconstructing it afterwards, and
report M-2 alongside M-1, which _is_ ledger-derived — if attended time falls and interruption count
does not, the timer is suspect, not the finding.

### M-3 · Time to mergeable PR — elapsed

**Definition.** Wall clock from **t₀** to **t_mergeable**.

- **t₀** — the moment the written brief is handed to the arm. Recorded in the registration file, to
  the minute.
- **t_mergeable** — the first moment at which the PR head simultaneously satisfies every clause of
  §06.

**Source.** Git commit timestamps plus the provider's PR and check-run API (GitHub _and_ GitLab —
`docs/reference` provider rules apply; nothing here may be GitHub-only). Not the ledger, which has no
duration field.

**Pause rule.** Elapsed time is calendar time and is **not** stopped for meals, sleep or other work.
It _is_ stopped for an external block that would have stopped both arms — a provider outage, CI
down, a blocking dependency. Every pause is logged with a start, an end and a cause at the time it
happens, and an unlogged pause does not count.

### M-4 · Total spend

**Source.** `GET /v1/ledger/runs/:runId/cost` → `totalSpendCents`, per arm, summed across the arm's
runs. Cross-checked against `ProvenanceReport.totals.spendCents` for the arm's branch.

**Floor semantics are load-bearing.** `summarizeRunCost` in `src/shared/alicorn/run-cost.ts` renders
an incomplete total as `≥ $X (partial)`, and this protocol inherits that rule: **a partial total is a
floor, never a figure, and a floor cannot settle a threshold.** If either arm's total is partial, the
run does not resolve M-4.

**Priced backends only.** `attributeDispatchUsage` prices `claude` and `codex`; every other backend
writes `spendCents: null` with `usage.status = 'unavailable'`. **Both arms are therefore restricted
to `claude` and `codex`.** This is compatible with the reviewer-backend rule (reviewer backend ≠
author backend), which the two priced backends satisfy between them.

**Human time is priced into the comparison, not into M-4.** M-4 is machine spend only. The
conversion of attended time to money happens once, in the threshold (§08), with a rate that is a
sign-off item.

### M-5 · Quality — a gate, not a score

Never traded against M-1 to M-4. All four clauses must hold for a run to count at all:

| Clause                                          | Evidence                                                                                                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every required check green on the merge commit  | `step_verifications` where `required = true` → `status = 'passed'` (today `kind` is `diff_coverage` only — see §11.6), **plus** the repository's CI status, which lives outside the ledger          |
| Reviewer backend ≠ author backend, not bypassed | `step_outcomes.review_backend_bypass = false` for every outcome in the arm; `ProvenanceReport.reviewBackend.enforced = true`                                                                        |
| No human correction inside the window           | No `step_outcomes.human_verdict = 'amended'` for the arm within **14 days** of merge, written by the corrections sweep (`src/main/alicorn/corrections/`). Never write `human_verdict` any other way |
| The PR was actually merged                      | Provider API                                                                                                                                                                                        |

**Why 14 days and not the 7 the `amended_within_window` gauge uses.** The gauge is an operational
signal sized for a dashboard; a quality claim wants a window long enough for the next person to
touch the code. 14 days is a proposal, and it is a sign-off item.

---

## 06 · What "mergeable" means

Checked on the PR head, all clauses simultaneously. The first timestamp at which they all hold is
**t_mergeable**, even if the merge itself happens later.

1. The PR is open against the target branch and has **no conflicts** with it.
2. **All required CI checks pass** on the head commit.
3. **Diff coverage** passes as a required check — `step_verifications` `kind = 'diff_coverage'`,
   `required = true`, `status = 'passed'`.
4. A **human reviewer who did not operate that arm** has approved it, reviewing the diff only —
   without being told which arm produced it (§07).
5. The PR **body carries its provenance** (tier-1 item 2), so the two arms are held to the same
   deliverable and not just the same diff.
6. **No open blocking review comment.** A non-blocking nit does not delay t_mergeable; the reviewer
   marks each comment blocking or not at the time of writing, before knowing the arm.

**A PR that later needs a follow-up commit was not mergeable.** That is what M-5's 14-day window
catches, and it is why quality is a gate rather than a fourth number to trade.

---

## 07 · Bias controls

Every one of these is cheap, and each closes a way the result could be talked into existence.

1. **Pre-registration.** Tickets, pairings, arm order, thresholds, operator assignment and the
   analysis itself are committed to git before t₀ of the first run (§09).
2. **Blind review.** The reviewer of clause 4 sees the diff and the PR body, not the arm. Branch
   names are opaque (`sm1-pair-<n>-<a|b>`), and the arm→branch mapping lives in a file the reviewer
   does not open until both reviews are in.
3. **The operator does not review their own arm.**
4. **Identical briefs.** Both arms receive the same written brief, byte for byte. It is written
   before the pairing is known and is not edited after t₀ of either arm.
5. **Isolated worktrees.** Separate worktree, separate branch, no shared chat context, no shared
   `.foreman/` journal. Neither arm's diff is read before both PRs are open.
6. **Alternating order.** In a replicated design the arm that runs first alternates by pair, so a
   learning effect cannot systematically favour one arm.
7. **No mid-run protocol changes.** If the protocol turns out to be wrong mid-run, the run is
   abandoned and re-registered. It is never patched in flight.
8. **Both directions are published.** A failing result is written up in the same places, at the same
   length, as a passing one. Committing to this before the run is most of what stops motivated
   reasoning after it.
9. **The measurement code is frozen.** No ledger, cost or report change lands between t₀ of the
   first pair and the last analysis. The commit SHA of the app under test is registered.

---

## 08 · PROPOSED thresholds — for sign-off, not agreed

> **None of the numbers in this section is decided.** They are a recommendation with reasoning, so
> that the sign-off in §10 is a decision about specific figures rather than a blank page.

### T-1 · Interruptions — must pass

**Proposed: `perCompletedTask` for arm F ≤ 0.5 × arm C**, on the pair-weighted mean.

_Reasoning._ The north-star metric is the product's thesis, and halving human involvement is a change
a developer feels within a day. A 20% reduction is inside the noise of three tickets and would be
indistinguishable from a good week. If Foreman cannot halve interruptions on the work it was designed
for, it is not worth an order of magnitude more money.

### T-2 · Value of returned attention — the primary economic test

**Proposed: the marginal cost of an hour of returned attention is below the fully-loaded hourly cost
of the developer.**

```
break_even = (spend_F − spend_C) / (attended_C − attended_F)      [$ per hour returned]
Foreman passes T-2 when  break_even < hourly_cost_of_developer
```

_Reasoning._ This is the honest economic question and it collapses spend and time into one number
that a buyer would recognise. It also handles the awkward cases correctly on its own: if Foreman
returns no attention, the denominator is zero or negative and Foreman fails without needing a special
rule; if Foreman is _cheaper_ the numerator is negative and it passes trivially, which is correct.

**The hourly figure is an input, not a fact, and it is a sign-off item (§10.2).** State it as one
number, in writing, before the run. A reader can then redo the arithmetic with their own figure —
which is exactly what a stranger should be able to do to a claim like this.

### T-3 · Spend ceiling — must pass, independent of T-2

**Proposed: `spend_F ≤ 10 × spend_C`.**

_Reasoning._ Two reasons to keep an absolute ceiling even with T-2 in place. First, T-2 can be passed
by a very expensive run that happens to save a lot of time on one unusual ticket; a ceiling stops one
outlier from setting the default path for everyone. Second, the borrowed figure we are replacing is
~15×, and **a token-efficiency product should not adopt as its recommended path something costlier
than the number it was embarrassed to be borrowing.** 10× is inside that, with margin. Alternative
worth considering at sign-off: a hard per-ticket dollar cap instead of a multiple, which is easier to
explain to a buyer and harder to game with a cheap control arm.

### T-4 · Elapsed time — must pass

**Proposed: `elapsed_F ≤ 1.25 × elapsed_C`.**

_Reasoning._ Foreman does not claim to be faster, so demanding a speed-up would test a claim we are
not making. But an arm that is simultaneously slower, more expensive and only modestly less
interrupting has nothing to sell. 1.25× tolerates the coordination overhead the pattern honestly has
while refusing an arm that takes twice as long.

### T-5 · Quality — disqualifying

**Proposed: M-5 must pass in full for arm F. A failure disqualifies the run regardless of T-1 to
T-4.** A cheaper, faster, less-interrupting run that gets amended within two weeks is the exact
failure mode the corrections watcher exists to catch, and ROADMAP §Risks names it _silent quality
drift_.

### The stop rule — what a failure changes

Pre-committing to the consequence is what makes the threshold real.

- **If Foreman passes** (T-1 and T-2 and T-3 and T-4 and T-5): `orchestrated` becomes the
  _recommended_ strategy for the tested class of ticket — long-running or multi-repo, in the
  registered size band. It does **not** become the default. `single` stays the default per CLAUDE.md;
  the escalation offer stays an offer.
- **If Foreman fails on any clause:** `single` stays the default, and the ~90% / 15× figure is
  **deleted** from CLAUDE.md and PROJECT-BRIEF and replaced by our own measured result. Not
  re-qualified, not footnoted — deleted. Continuing to cite a borrowed number after measuring our own
  is the failure this ticket exists to prevent.
- **Either way**, `docs/alicorn/FOREMAN.md` § _Measuring it_ records the numbers, the date, the
  registration SHA, and the app SHA under test.

---

## 09 · Registration — the mechanism

1. The sign-off in §10 is filled in **in this file**, with the agreed values and a date.
2. That edit is committed on its own — `docs(measurement): register the SM1 thresholds` — and pushed.
   **The commit SHA is the registration.**
3. The SHA is recorded on Plane SM1 (ALC-87) as a comment.
4. Only then does t₀ of the first pair start.

**Why this ordering is checkable rather than trusted.** The registration is a commit with a
timestamp; the first evidence of a run is `step_outcomes.created_at`, which is **server** time
(`client_ts` is forensics only — ARCHITECTURE's rule). If the earliest `created_at` for either arm
precedes the registration commit, the run is void. Anyone can verify that afterwards without taking
our word for it, which is the whole point of agreeing the threshold first.

---

## 10 · Requires sign-off before the run

**The human owner must fix each of these in writing, in this file, before t₀.** An unanswered row
blocks the run — not the whole run's design, this specific list. Ten minutes of decisions.

| #     | Decision                                                                                           | Recommendation                                                                                                                      | Agreed value |
| ----- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 10.1  | **What is arm C?** Developer + single agent, or developer unaided                                  | Developer + single agent — it is what a user actually gives up (§04.1)                                                              | _(unfilled)_ |
| 10.2  | **Fully-loaded hourly cost of the developer**, used in T-2                                         | One number, stated, so a reader can redo the arithmetic                                                                             | _(unfilled)_ |
| 10.3  | **Design and n.** Design A, B or C; how many pairs                                                 | Design C at n = 3; design A for one pair if a second operator exists                                                                | _(unfilled)_ |
| 10.4  | **The tickets.** Plane keys, pairings, arm order                                                   | Registered by key before t₀; size band 0.5–2 ew, within Foreman's envelope                                                          | _(unfilled)_ |
| 10.5  | **T-1 ratio**                                                                                      | ≤ 0.5×                                                                                                                              | _(unfilled)_ |
| 10.6  | **T-3 form and value** — multiple of arm C, or absolute per-ticket cap                             | ≤ 10× arm C                                                                                                                         | _(unfilled)_ |
| 10.7  | **T-4 ratio**                                                                                      | ≤ 1.25×                                                                                                                             | _(unfilled)_ |
| 10.8  | **M-5 correction window**                                                                          | 14 days                                                                                                                             | _(unfilled)_ |
| 10.9  | **Operators and reviewer.** Who runs each arm; who reviews blind                                   | Operator does not review their own arm (§07.3)                                                                                      | _(unfilled)_ |
| 10.10 | **The stop rule**, confirmed verbatim, including deleting the borrowed figure on failure           | As written in §08                                                                                                                   | _(unfilled)_ |
| 10.11 | **FM6 as a third arm?** Whether the Claude Code `workflow` executor spike runs on the same tickets | Separately — a three-way comparison at n = 3 resolves nothing, and FM6's question is _which executor_, not _whether to orchestrate_ | _(unfilled)_ |
| 10.12 | **Ledger prerequisites** (§11) — which are fixed before the run, which are worked around           | Fix 11.1 and 11.4; work around the rest                                                                                             | _(unfilled)_ |

**Signed off by:** _(name)_ · **on:** _(date)_ · **registration commit:** _(SHA, filled by §09.2)_

---

## 11 · Ledger gaps this protocol depends on

Found while writing the protocol against the shipped code. **None is built by SM1** — SM1 is a docs
ticket. Each is listed as a dependency with what the protocol does in the meantime.

| #    | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Impact                                                                     | Workaround for this run                                                                                            | Proposed fix                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 11.1 | ~~**The interruptions report cannot filter by `run_id` or `execution_strategy`.**~~ **Fixed by LG5 (ALC-105)** — `--run <id>` and `--strategy <single\|orchestrated>` are on the filter, the RPC and the CLI. **Still missing:** `--compare-runs <a> <b>`, named in [foreman-core](plans/2026-09-06-foreman-core.md) Task 10, which is a second command over two reports, not a filter                                                                                                            | —                                                                          | —                                                                                                                  | File `--compare-runs` separately: it is a formatting command, not a ledger change                                                                                  |
| 11.2 | ~~**`completedTasks` counts tasks touched, not tasks completed.**~~ **Fixed by LG5 (ALC-105)** — `completedTasks` now requires `outcome = 'succeeded'`, `tasksTouched` carries the old count, and both are emitted with `completedTaskDefinition` saying which rule was used. **Still open:** _which_ definition. (a) any successful step is what ships; (b) terminal stage succeeded and (c) no failed step outstanding are reserved for the user, to be chosen once two real arms have diverged | —                                                                          | —                                                                                                                  | Swap `completedTaskPairsSql` in `interruptions-repository.ts`; the contract already declares all three values so the change is not a wire change                   |
| 11.3 | **No duration on any ledger row.** `step_outcomes` has `created_at` (server) and `client_ts` (the dispatch's `completed_at`); no start time. Per-dispatch wall clock exists only in the client's orchestration SQLite (`dispatchedAt`, used by `run-cost-publisher.ts`)                                                                                                                                                                                                                           | M-3 cannot come from the ledger                                            | Git and provider timestamps                                                                                        | A `started_client_ts` column, forensics-only like `client_ts`                                                                                                      |
| 11.4 | **`step_interruptions` has no `resolved_at`.** It has `occurred_at` and `resolved_by`, so an interruption's arrival is recorded but not its cost                                                                                                                                                                                                                                                                                                                                                  | M-2, the measure Foreman's case rests on, is hand-timed                    | A manual timer, logged per event                                                                                   | **The highest-value fix here.** `resolved_at TIMESTAMPTZ` is additive and cheap, and it makes attended time computable for every run afterwards, not just this one |
| 11.5 | **Cost covers `claude` and `codex` only.** Every other backend writes `spendCents: null`, `usage.status = 'unavailable'` (`provider_unsupported` / `usage_not_enabled`)                                                                                                                                                                                                                                                                                                                           | A mixed-backend arm produces a floor, and a floor cannot settle T-2 or T-3 | Restrict both arms to the two priced backends                                                                      | Out of scope; the "—, never a guess" rule is correct as it stands                                                                                                  |
| 11.6 | **`step_verifications.kind` is `'diff_coverage'` only.** Typecheck, lint and test results live in CI, not the ledger                                                                                                                                                                                                                                                                                                                                                                              | "Every required check green" is only partly ledger-evidenced               | §06 clause 2 reads CI as well as the ledger, and says so                                                           | Widen `kind` when required checks become stage-authored (v1.5)                                                                                                     |
| 11.7 | **No CLI for run cost or provenance.** The ledger CLI is `report`, `outbox`, `outbox-requeue`; cost and provenance are HTTP-only                                                                                                                                                                                                                                                                                                                                                                  | The protocol curls, or reads the desktop                                   | `ledger cost --run <id>` and `ledger provenance --repo <id> --branch <name>`, mirroring the existing handler shape |
| 11.8 | **Binary name in flux.** Spec usage strings say `orca ledger report`; the rebrand (R1–R5) renames the binary to `alicorn`                                                                                                                                                                                                                                                                                                                                                                         | Cosmetic, but a protocol that names the wrong binary gets run wrong        | Both names appear in §02                                                                                           | None — resolved by R5                                                                                                                                              |

**Blocker worth naming separately:** the sequencing plan's _blocker zero_ — the cloud toolchain does
not build on the current machine (pnpm 9 vs the required 10, empty `cloud/node_modules`). It is
cleared per-worktree with a pnpm shim and a dedicated Postgres slot, which is how LG5 built and
verified 11.1 and 11.2. 11.4 is still `Lane: ledger-api` and unbuilt.

---

## 12 · Failure modes of the measurement itself

Stated plainly, in the brief's style, because a protocol that only lists its strengths is marketing.

- **n is small and ticket variance is large.** At n = 3, one unusually gnarly ticket can decide the
  result. The pairing rule (§04.4) reduces this; it does not remove it. The write-up must carry the
  per-pair numbers, not only the mean, so a reader can see whether one pair carried the verdict.
- **One operator is one skill level, with one set of habits.** A developer who is fluent at steering
  a single agent and new to briefing a lead will produce a control-favouring result, and the reverse
  is equally possible. Registering arm order and alternating it helps a little. Nothing available at
  this team size fixes it.
- **Attended time is self-reported.** M-2 is the softest measure and the one the economic case leans
  on hardest. Mitigated by logging intervals live and by cross-checking against ledger-derived M-1
  (§05), not solved. Gap 11.4 is the real fix.
- **"Mergeable" is partly a judgement.** Clause 4 is a human approval. Blind review and the
  blocking/non-blocking call made before the arm is known are what keep it honest.
- **The Hawthorne effect points at both arms, unevenly.** The operator knows Foreman is on trial. The
  arm they hope wins is likely to get more care. Pre-registration constrains the analysis, not the
  effort.
- **Spend is a floor whenever anything is unpriced.** Enforced by restricting backends, but a stray
  dispatch on an unpriced backend voids M-4 rather than shading it — and it must be treated that way,
  because `≥` reading as `=` is exactly the mistake `formatRunCostSummary` was written to prevent.
- **A passing result is narrower than it will sound.** It licenses `orchestrated` as _recommended for
  long-running or multi-repo tickets in the registered size band, in this repository, at this app
  SHA_. It does not license "multi-agent beats single-agent". Every restatement must carry the
  qualifier, or we have simply minted a new borrowed number and borrowed it from ourselves.

---

## 13 · Where the result is recorded

1. **`docs/alicorn/FOREMAN.md` § _Measuring it_** — the numbers, per pair and pooled, the date, the
   registration SHA and the app SHA. This is the location [foreman-core](plans/2026-09-06-foreman-core.md)
   Task 10 already specifies.
2. **This file** — a _Result_ section appended below §13, never edited into §08. The proposal and the
   outcome stay visibly separate, so a later reader can see the threshold was set first.
3. **Plane SM1 (ALC-87)** — result comment, linking both.
4. **[CLAUDE.md](../../CLAUDE.md)** — the sentence _"the public figure is ~90% better results for ~15×
   the tokens, measured on research tasks, not on shipping features. We have not measured it on our
   own repos yet"_ is the sentence that changes. Replacing it is what finishing SM1 means.
5. **[PROJECT-BRIEF.md](PROJECT-BRIEF.md) §11.7 and §12** — the decision gets its outcome; the risk
   _"We have no evidence a team of agents beats one agent on our work"_ is either closed or restated
   with our own number.

---

_Alicorn measurement protocol · SM1 (ALC-87) · draft, thresholds unsigned · 2026-09-08_
