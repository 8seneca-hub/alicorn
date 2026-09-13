# Alicorn — Project Brief

> Project brief for review · final · 2026-09-06. Converted from the review artifact into the
> repository so plans can cite it. **Status:** the recommendations in §11 were all accepted on
> 2026-09-06; see `CLAUDE.md` → _Decisions taken_. The tier-one slice in §08 is committed and
> planned in [`plans/`](plans/).

**Alicorn** — an agent development environment for developers who now spend the day directing
agents instead of typing. Context stays small, tokens stay cheap, quality is a gate rather than a
hope.

|              |                                           |
| ------------ | ----------------------------------------- |
| Base         | Hard fork of Orca                         |
| Design base  | Existing team prototype                   |
| UI           | Orca's, for now                           |
| Code written | None yet — docs only (at time of writing) |

---

## 01 · How to read this document

_Attribution matters here._ The existing design — the prototype, `ARCHITECTURE.md`, `ROADMAP.md` —
is the base and stands unchanged. This brief adds a layer on top and marks every item with where it
came from, so review can focus on what is actually new rather than re-approving settled work.

| Tag          | Meaning                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| **base**     | From the existing prototype and docs. Already designed, already estimated, not up for debate here.       |
| **extends**  | Builds on a mechanism the base already provides. Usually small, because the hard part is already funded. |
| **new**      | Genuinely new. This is what needs scrutiny — and where the added cost sits.                              |
| **deferred** | Interface work, intentionally postponed. We ship on Orca's UI first and build logic.                     |

Three corrections made while writing this, worth stating because each was a real collision with the
base:

1. "Contract Ledger" → **Contract Registry**. _Ledger_ already means the append-only measurement
   ledger the autonomy policy reads from. Two things with opposite retention and blast radius must
   not share a word.
2. **"Team mode" deleted entirely.** It was the Workflow feature under a second name. See §04.
3. **"Mode" avoided as a term.** Already taken twice — `permission_mode` on a member and `mode` on
   an autonomy policy. The new field is `execution_strategy`.

## 02 · The goal

The job of a developer changed. Most of the day is no longer typing code — it is briefing agents,
waiting on them, reading what they produced, and carrying messages between them. Editors assume you
type; terminals assume you run commands; agent runners assume one agent, one task, one window.

Alicorn is an ADE. The unit of work is a ticket, not a file. Four pillars, treated as working
constraints — a change that harms one needs a stated reason.

- **Context efficiency.** An agent that forgets an hour-old decision is worse than no agent. State
  belongs on disk, and ceilings bind well before the window is full — quality degrades around
  300–400k tokens, not at 100%.
- **Token efficiency.** Orchestrating a team costs roughly an order of magnitude more than one
  agent. Never spend that by default; make it opt-in per task, and show the meter while it runs.
- **Quality.** Done is a set of machine-checkable gates. Two rules cut cost and raise quality: a
  reviewer never runs on the author's backend, and a QA member never reads the implementation it
  tests.
- **A UI you can drive.** One tab per ticket, status and cost visible without opening anything.
  Deferred — but it is the pillar a user actually sees, so it cannot slip forever.

**The wedge** (base). Agents made writing code cheap. They did not make accepting it cheap, and that
is where the queue forms: review time up 441%, agent-authored PRs sitting 5.3× longer, trust in
AI-written code at 29%.

> A reviewer receives a finished diff with no implementation journey and no decision trail. They
> have to reconstruct intent from the ticket and the code.

No better model fixes that — it is missing information, not missing intelligence. North-star metric:
`interruptions_per_completed_task`, with the corrections watcher guarding against the failure mode
where interruptions fall while quality quietly falls with them.

## 03 · The base (existing design — unchanged)

Everything in this section is already designed and estimated. It is the product; the rest of this
brief extends it.

- **Members** (base). A saved, reusable role: name, agent backend (Claude Code, Codex, Grok,
  OpenClaude), skills, workspace kind (git worktree or folder), `permission_mode`, system rules.
  Folder workspaces let non-engineering members work without a repo checkout.
- **Workflows & board** (base). Stages, owners and triggers as a saved object, with the return edge
  first-class on the canvas. Stages bind to board columns — one model, two views. A column
  transition dispatches a member; Done closes the ticket in the tracker.
- **Ledger** (base). Append-only and exactly-once: `step_outcomes`, `step_verifications`,
  `member_stage_stats`. Server time orders everything. The autonomy policy reads from it, so a
  ledger that double-counts is worse than none.
- **Corrections watcher** (base). Writes `human_verdict = 'amended'` from post-hoc corrections — a
  follow-up commit to the same files, a revert, a reopened task. Without it accept rate drifts up
  while quality drifts down.
- **Autonomy** (base). The strongest idea in the current design, and it stays exactly as specified.
  Gates retire when evidence replaces them; hard stops never retire, whatever the numbers say.
  `reversibility` and `inherited_cost` are authored on the stage, never inferred — a system that
  guesses which step is irreversible guesses wrong once, and that once is a production deploy.

| Level           | Behaviour                                             | Entry condition                              |
| --------------- | ----------------------------------------------------- | -------------------------------------------- |
| 0 · Observed    | Always gates; records the decision it would have made | default                                      |
| 1 · Advisory    | Gates, pre-fills a recommendation, measures agreement | runs ≥ 10                                    |
| 2 · Conditional | Auto when verified and inside budget                  | runs ≥ 20, accept ≥ 0.90                     |
| 3 · Autonomous  | Notifies instead of blocking                          | runs ≥ 50, accept ≥ 0.95, no amendment in 20 |

Demotion: one rejection, or two amendments within the last ten runs, drops a stage a level
immediately and requires the full entry condition again. Windows are the last 50 runs, not lifetime.
Blast radius — files, spend, protected paths — is capped per run, and exceeding it escalates
regardless of level.

## 04 · Execution: two axes, not three modes (corrected)

An earlier draft proposed three modes — Direct, Team, Foreman. That was wrong, and the error is worth
showing because the fix makes the design cheaper.

"Team mode" was the Workflow feature: stages, owners, triggers, hand-offs, a return edge. Naming it a
mode created a second vocabulary for something the base already owns — the same trap as "Contract
Ledger".

The proof it was wrong: three exclusive modes cannot express "run the normal workflow, but decompose
only the Build stage." Pick Team and there is no lead; pick Foreman and the stages and gates
disappear. Yet that combination is the most useful case in practice — the process is fine, one step
is just large.

Two independent axes express all four cases:

| Execution strategy         | Workflow **not** attached                                                                                                                                                      | Workflow attached                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **single agent**           | _Today's Orca._ You brief one agent in one session. No orchestration tax at all. Bug fixes, small features, exploring. **~90% of daily work · the default.**                   | _The existing Team design._ Column change dispatches a member. Stages, gates, autonomy levels, findings returned to the author. **This is the Workflow feature — not a mode.**                              |
| **orchestrated (Foreman)** | _One big ticket, decomposed._ No process, but the work is too large for one context window. A lead plans and dispatches; journal on disk survives the session. ~10–15× tokens. | _Workflow, one stage decomposed._ Spec and Review run one agent each. Build gets a lead and subagents. Gates, hand-offs and autonomy all keep working normally. **The cell three modes could not express.** |

Escalation is a per-task decision rather than a run-wide flip: a task running as a single agent
offers to switch to orchestrated execution when its context crosses the ceiling or it turns out to
touch more than one repo. Nothing about the workflow changes when it does.

Concretely: `execution_strategy` is a field on a task or stage with values `single` and
`orchestrated`. Foreman stops being a global mode and becomes a strategy you can enable for one
stage — which is more precise, and cheaper, than what the three-mode framing implied.

## 05 · Foreman — the add-on, opt-in per task

Foreman is the industry's orchestrator-subagent pattern — LangGraph calls it _supervisor_, OpenAI
calls it _manager_. We should say so rather than present it as novel, and inherit the proven core: a
fresh context window per subagent, a self-contained task description with an explicit output format,
subagents that cannot coordinate mid-task, and a lead that synthesizes and re-plans.

Three places we go deliberately stricter, and these are ours:

- **Context boundary.** Subagents (BE work ~120k tokens · FE work ~140k · Review — diff + contract
  only — ~80k) are allowed to be messy inside their own sandbox; their context is cheap and
  disposable. The expensive context is the lead's, and nothing but a typed **report ≤ 1500 tokens**
  crosses into it: `status`, `summary` (≤ 3 sentences), `changes[]` (paths only),
  `interface_delta[]`, `verification`, `open_questions[]`, `cost`. Want to say more? Write a file,
  return the path.
- **The lead** has a hard ceiling ≤ 40% of window, **writes no code, reads no implementation**,
  compacts to and rebuilds from the Feature Journal (plan + node status, decisions & assumptions,
  contract registry, running cost). The canonical orchestrator also handles some subtasks itself;
  ours does not.
- **Journal** (new). The run's source of truth, on disk. Kill the process, come back tomorrow, it
  resumes. This is what makes a feature spanning days possible at all.
- **Contract Registry** (new). Typed interfaces between repos — extracted from OpenAPI and types
  where they exist, agent-declared only where they don't. ~200 tokens per endpoint instead of a
  40k-token conversation, with a breaking flag.
- **Rulebook** (extends). A recurring finding is promoted into a member's standing rules, committed
  to the repo. Fed by the corrections watcher — see §06.

Relationship to the base's v2.0 agent-composed teams — "a goal in; the system selects specialists,
composes the team and runs the chain": these are not competing. Foreman is the mechanism that
agent-composed teams would run on. Build the mechanism first, let agents choose when to use it later,
and do not build two.

## 06 · Two places the halves meet (the argument of this brief)

**1 · The PR body is already almost built.** Our own diagnosis says reviewers are blocked because a
diff arrives with no implementation journey and no decision trail. The provenance panel — already
scheduled and estimated — assembles exactly that: checks, reversibility, blast radius, track record,
policy, exportable. Posting that to the pull request instead of only rendering it in-app is a small
delta on funded work. It is the one item here a stranger appreciates in ten seconds, and it attacks
the number we lead with. Treat it as the **v1.0 launch feature**, and let the Journal enrich it later
rather than gate it.

**2 · The corrections watcher is already the Rulebook's input.** The watcher writes
`human_verdict = 'amended'` when a human quietly fixes agent output. As specified, that event costs a
member a level and is then forgotten — the member is demoted but no wiser, and re-earns the level
while making the same mistake. An amendment is a finding a human paid for by hand. The same event
that triggers demotion should also propose a standing rule on the member that caused it. Demotion
measures the problem; a rule fixes it. The Rulebook is mostly a second consumer of an event we are
building anyway.

## 07 · Consolidated feature list

Engineer-weeks (ew), in the same unit as the existing roadmap: a team of 3–4 already fluent in the
codebase. Base figures are quoted from that roadmap unchanged; added figures are new estimates.

### v0.1 — Instrument · weeks 0–9 · nothing automated yet, you start measuring

| Feature                                                         | Origin | ew  |
| --------------------------------------------------------------- | ------ | --- |
| Rebrand — app id, CLI, ~600 call sites, 886 env vars, CI gate   | base   | 4–6 |
| Localisation — ~800 strings across 8 catalogs                   | base   | 2–3 |
| Identity — Keycloak 26+, Control API, org→policy mapping        | base   | 4–6 |
| Backend cutover — relay, update feed, telemetry, artifacts      | base   | 2–3 |
| Distribution — Apple notarisation, Windows EV cert, glibc floor | base   | 1–2 |
| Members — entity, library, editor                               | base   | 3–5 |
| Ledger — step outcomes, verifications, stage stats              | base   | 2–3 |
| Corrections watcher — post-hoc amendment detection              | base   | 2   |
| Cut point — pin `UPSTREAM_BASE`, stop merging upstream          | new    | —   |

### v1.0 — Remove the babysitting · weeks 8–19 · first sellable release

| Feature                                                       | Origin  | ew    |
| ------------------------------------------------------------- | ------- | ----- |
| Board automation — rule engine, loop detection, kill switch   | base    | 4–6   |
| Plane provider — fifth entry in the tracker registry          | base    | 4–6   |
| Gate policy — `evaluateGate`, levels 0–1                      | base    | 3–4   |
| Blast-radius budgets — files, spend, protected paths, per run | base    | 2–3   |
| Provenance panel — why no human was asked, exportable         | base    | 2     |
| PR body posted from the provenance data                       | extends | 1–2   |
| `execution_strategy` on task/stage + escalation offer         | new     | 2–3   |
| Context capture — exact prompt and context slice per run      | new     | 1–2   |
| Diff coverage as a stage `required_check`                     | extends | 1–2   |
| Reviewer backend ≠ author backend, enforced                   | extends | 0.5–1 |
| Per-run cost attribution surfaced                             | extends | 1–2   |

### v1.5 — Remove the hand-off · weeks 17–27

| Feature                                                             | Origin  | ew  |
| ------------------------------------------------------------------- | ------- | --- |
| Authored workflows + canvas — stages, owners, triggers, return edge | base    | 6–8 |
| Stable stage keys — level 3, automatic retirement and demotion      | base    | 3   |
| Voice intent routing — transcript to an agent holding the CLI skill | base    | 3–4 |
| Org platform — orgs, invites, seats, org skill catalog              | base    | 5–8 |
| Foreman core — Journal + bounded report protocol                    | new     | 6–9 |
| Rulebook — amendments promoted to standing rules                    | extends | 3–4 |
| Project-scoped skills — third scope beside org and member           | extends | 2–3 |
| Skill version pinning per member                                    | extends | 1–2 |

### v2.0 — Agents author the workflow · weeks 25–39

| Feature                                                               | Origin | ew   |
| --------------------------------------------------------------------- | ------ | ---- |
| Cross-agent mailbox — backend-neutral addressing and delivery         | base   | 8–12 |
| Agent-composed teams — a goal in, a team composed and run             | base   | 6–8  |
| Policy at scale — cross-project orchestration, org budgets            | base   | 3    |
| Contract Registry — extraction, breaking-change flag, mock generation | new    | 4–6  |
| Multi-repo feature workspace — repo/branch/worktree tuples            | new    | 3–5  |
| Integration verify — contract tests across both sides                 | new    | 2–3  |
| QA context sandbox — tool-level enforcement, not a prompt rule        | new    | 2–3  |

### Deferred — interface work, after v1.0

| Feature                               | Origin        | ew  |
| ------------------------------------- | ------------- | --- |
| Tab = session, one tab per ticket     | deferred · UI | 3–5 |
| A new tab opens an agent, not a shell | deferred · UI | 2–3 |
| Run view + Context Inspector surface  | deferred · UI | 3–4 |

| Totals                        |            | ew    |
| ----------------------------- | ---------- | ----- |
| Base total                    | v0.1–v2.0  | 69–97 |
| Added total — extends and new | v1.0–v2.0  | 30–47 |
| Deferred UI                   | after v1.0 | 8–12  |

The added 30–47 ew lands almost entirely on the two full-stack desktop engineers — the backend
engineer is occupied with Keycloak, the Control API and the Ledger. That is 15–24 calendar weeks of
additions on the constrained resource, enough to move the v1.5 date on its own.

## 08 · Agreed first slice — ships with v1.0 · 7–12 ew

Rather than take all 30–47 ew, the additions are tiered. Only the first tier is committed.

| #   | Item                                    | Why this one first                                                                                                        | ew       |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `execution_strategy` + escalation offer | Must exist before board automation makes automated dispatch the default path, or every run pays the orchestration premium | 2–3      |
| 2   | PR body from provenance data            | The only item a stranger appreciates in ten seconds, and a small delta on already-funded work                             | 1–2      |
| 3   | Context capture                         | Cheap, and it is the only way to tell an underinformed member from a wrong one when something goes bad                    | 1–2      |
| 4   | Diff coverage required check            | Configures a mechanism the base already provides; makes "tested" mean something                                           | 1–2      |
| 5   | Reviewer ≠ author backend               | Our sharpest quality claim, and it is a policy check rather than machinery                                                | 0.5–1    |
| 6   | Per-run cost attribution                | Token efficiency has to be visible while working, not in a report nobody opens                                            | 1–2      |
|     | **First slice**                         |                                                                                                                           | **7–12** |

**Sequencing warning.** Every item above depends on v0.1 landing first — items 2, 5 and 6 need the
Ledger and Members, item 4 needs stage `required_checks`. No product code exists yet, so this slice
is planned now and executed after v0.1, not in parallel with it.

> **Resolution (2026-09-06).** Tier 1 is executed _first_, by pulling its v0.1 dependencies forward
> onto the real control plane (Postgres; identity/Keycloak deferred to a follow-up) rather than
> waiting for all of v0.1. See
> `CLAUDE.md` → _Tier 1_ and the plans in `plans/`.

## 09 · Quality gates — what "done" resolves to

Two constraints do double duty, cutting cost and raising quality. A QA member that reads the
implementation writes tests matching the bug; blindfold it and it writes tests matching the
requirement. A reviewer that reads the developer's reasoning gets argued into agreement; give it the
diff and the contract only.

- ✓ Build and typecheck clean across every repo the run touched — base
- ✓ Tests derived from acceptance criteria pass, each traceable to one criterion — base
- ✓ Diff coverage meets threshold — not repo coverage, which is gameable and universally ignored — extends
- ✓ Contract tests pass; no undeclared breaking change — new · v2.0
- ✓ No open high-severity findings — the review loop ended because findings ran out, not a retry counter — base
- ✓ Reviewer backend differs from the author's backend — extends
- ✓ Every assumption made on the user's behalf appears in the PR body — extends
- ✓ Spend and blast radius stayed inside the run budget — base

Required checks are authored on the stage, never by the member being judged — that invariant is in
the base and the additions respect it. Skills are where checks are implemented, which is why project
scope matters: org catalog and per-member custom exist today, but the conventions of this repo belong
in the repo, committed and reviewed like code. Skill versions pin per member, because a silent
upgrade is a silent behaviour change and gates then fail for reasons nobody can trace.

## 10 · Fork posture — decided: we own the core

This is a hard fork. We patch core directly and Alicorn becomes its own product under its own brand.
A plugin could not carry a full rebrand plus the interface work, and it would leave the product's
identity in someone else's hands.

That settles the architecture. The operational question remains: upstream is at ~62k stars, ships
most days, and landed roughly 500 merged PRs between two consecutive releases — much of it platform
grunt work (Windows and WSL paths, SSH reliability, Git version compatibility, EDR posture, the glibc
floor). Once we stop merging, that becomes ours.

| Phase     | Upstream relationship        | Why here                                                                                                                                                      |
| --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Track** | Merge often, take everything | The rebrand is configuration, copy and branding — the work that conflicts least with upstream. The cheapest window we will ever have to absorb their fixes.   |
| **Cut**   | Pin the tag, stop merging    | The day the rebrand CI gate goes green. Record tag and SHA in `UPSTREAM_BASE`. After this, upstream is a source to cherry-pick from, never a branch to merge. |

The deferred interface work is what spikes divergence, so it lands after the cut — no sense merging
upstream changes into files we are about to rewrite. Keep three things regardless: the platform
hazard notes in `docs/reference/`, the ratchet tests that enforce them, and MIT attribution (retain
`LICENSE`, add a `NOTICE`). The hazard notes are hard-won operational knowledge worth more than the
code they describe, and a rebrand is exactly when someone will be tempted to delete them.

## 11 · Decisions we need (all accepted 2026-09-06)

1. **Do we accept the first slice at 7–12 ew, and defer the rest?** The full set of additions is
   30–47 ew on two engineers. Tiering is what keeps the v1.5 date reachable.
   _Recommendation: yes — commit tier one, revisit the rest after v1.0 ships and the ledger has real
   numbers in it._
2. **Is the PR body the v1.0 launch feature?** It is a small delta on the provenance panel, and the
   only item a stranger appreciates immediately.
   _Recommendation: yes. Treat it as the headline, not as a Foreman detail._
3. **Does the corrections watcher also feed a Rulebook?** Today an amendment demotes a member and is
   then forgotten. The same event could write a standing rule.
   _Recommendation: yes, as a second consumer of an event already being built. v1.5, once there is
   amendment history worth reading._
4. **Do we enforce "reviewer backend ≠ author backend" by default?** Our sharpest quality claim, but
   it makes multi-backend setup effectively mandatory, raising the cost of getting started.
   _Recommendation: enforce by default, allow explicit opt-out, and record in the run report whenever
   it was bypassed._
5. **When exactly is the upstream cut point?** After it, upstream's platform maintenance is ours.
   Before it, every merge is nearly free.
   _Recommendation: cut when the rebrand CI gate goes green; merge greedily until then._
6. **How long can the interface work stay deferred?** Logic-first is right for engineering risk. But
   the ADE thesis is a UI thesis — tab-as-session and agent-first surfaces are what a user actually
   sees.
   _Recommendation: schedule it immediately after v1.0. If it slips past v1.5 we ship an Orca with
   extra backend features and no visible identity of our own._
7. **What counts as success, and when do we measure it?** Everything here assumes a team of agents
   beats one agent on real work. We have not measured that on our own repos; the public figure we
   borrow is from research tasks, not shipped features.
   _Recommendation: use the v0.1 `interruptions_per_completed_task` baseline. Then at v2.0, compare
   Foreman against one developer on a real ticket — time to a mergeable PR and total spend. Agree the
   threshold before running it._

## 12 · Risks — stated plainly

- **The estimates assume fluency we do not have yet.** The roadmap's figures are for a team "already
  fluent in the codebase". We cloned it this week, and it is a large Electron/TypeScript application
  with substantial platform complexity. Add 2–4 weeks of ramp-up, or every number here is optimistic
  in the same direction.
- **The first slice cannot start until v0.1 lands** (as written; resolved by pulling the substrate
  forward — see §08). Items depending on the Ledger, Members and stage required checks are planned
  now and executed later — planning them early is useful, scheduling them in parallel is not.
- **After the cut, upstream's platform maintenance becomes ours.** The accepted cost of owning the
  core, and it is a knowledge cost more than a code cost. Windows EDR behaviour, WSL argv quoting,
  Git version floors and the glibc baseline were learned by shipping to a very large number of
  machines.
- **We have no evidence a team of agents beats one agent on our work.** The public figure — roughly
  90% better for ~15× the tokens — is from research tasks. Until we measure on our own tickets the
  economic case is borrowed, not ours. This is the strongest argument for keeping single-agent the
  default.
- **Orchestration is a token multiplier and we are selling token efficiency.** These pull against
  each other. Per-task `execution_strategy` is the answer, but only if `single` stays genuinely the
  default and escalation stays genuinely opt-in.
- **"Forbidden to read" is only real if the tool layer enforces it.** A line in a system prompt is a
  suggestion. QA not reading the implementation needs actual sandboxing at the tool boundary, which
  is why it is costed at 2–3 ew rather than 0.5, and why it sits in v2.0 rather than being claimed
  early.
- **Contract extraction degrades to agent assertion in repos without schemas.** Reliable with
  OpenAPI or shared types; only as good as the agent's word without them. Generating a schema may
  need to be a precondition rather than a nice-to-have.
- **The differentiators are slow to reveal themselves.** Journals, registries and context ceilings
  are day-30 virtues. The PR body, cross-model review and per-run cost are what a stranger sees on
  day 1 — weight the launch accordingly.

---

_Alicorn project brief · final · base: existing team design · hard fork of Orca (MIT) · 2026-09-06_
