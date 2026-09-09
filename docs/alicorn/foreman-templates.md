# Foreman templates

Three templates: the brief you send, the report you get back, and the journal you keep.

---

## 1 · Subagent brief

Paste this shape into every `Agent` dispatch. A brief missing any section produces work you will
have to throw away.

```markdown
## Objective
<One paragraph. What "done" looks like, concretely and verifiably.>

## Scope
Repo/paths you own:   <exact paths>
Commands you may run: <build, test, lint — be specific>
Workspace:            <worktree | folder>

## Boundaries — do NOT do these
- Do not touch <path>. Another subagent owns it.
- Do not refactor anything you were not asked to change.
- Do not commit, push, or open a PR.
- <anything else that is someone else's job>

## Contract you build against
<Paste the interface contract verbatim — the endpoint shape, the type, the schema.
Never paste another subagent's transcript or reasoning. The contract is the only
thing that crosses between subagents.>

## Verification
Before reporting done, run: <exact command>
It must: <exact expected result>
If it cannot run, say so in `status: blocked` — do not report success.

## Report back
Return ONLY the report schema below. Nothing else — no transcript, no narration,
no file contents. Hard ceiling ~1500 tokens.
If you need to say more, write it to a file and return the path in `artifacts`.
```

**Model selection.** Pass an explicit `model` on the dispatch. Implementation gets a strong model;
mechanical work (renames, scaffolding, doc lookup) gets a cheap one. **Review gets a model different
from whichever wrote the code** — this is not optional, it is the quality mechanism.

**Isolation.** For anything that edits files, dispatch with `isolation: "worktree"` so subagents
cannot clobber each other.

---

## 2 · Report schema

What comes back across the boundary. Enforce the ceiling — if a report arrives as a wall of prose,
reject it and re-dispatch with the schema quoted more forcefully.

```yaml
status: done | blocked | needs_decision | failed

summary: |
  <At most three sentences. What you did, not how you felt about it.>

changes:
  - repo: <name>
    path: <path>
    kind: added | modified | deleted
    why: <half a line>
  # paths only — never file contents

interface_delta:
  # Only if you changed something another part of the system depends on.
  # This is the ONLY thing that crosses to another subagent.
  - kind: http_endpoint | type | event | schema | cli
    name: <e.g. POST /refunds/partial>
    shape: <request/response, or the type signature>
    breaking: true | false

verification:
  command: <exact command run>
  result: pass | fail | could_not_run
  evidence: <one line — counts, or the failing assertion>

open_questions:
  - <only things that genuinely block, not curiosities>

artifacts:
  - <path to anything too long for this report>

cost:
  tokens_in: <n>
  tokens_out: <n>
```

**`could_not_run` is not `pass`.** A subagent that could not verify says so. Fail closed.

---

## 3 · Journal

Lives at `.foreman/<task-id>/journal.md`. Written as you go. This is the source of truth — your
context is a cache of it.

```markdown
# run_alc42 — partial refunds

**Status:** running
**Started:** 2026-09-07T00:00:00.000Z   **Budget:** $50.00
**Spent so far:** $12.34

## Objective
One paragraph, from the user.

## Team
> Composed by Orca from member roles and their accept rate at each seat's stage, then **approved by
> a human at a gate** — never applied silently. Orca writes this section; the gate row holds the
> verdict, so nothing here says whether it was accepted.

**Gate:** gate_alc42
**Goal:** Ship partial refunds end to end.

| Seat | Stage | Member | Id | Backend | Accepted | Runs | Why |
|---|---|---|---|---|---|---|---|
| developer | build | Ada | mem_dev1 | claude | 92% | 24 | Best of 3 developer candidates: 92% accepted over 24 run(s) at "build". |
| reviewer | review | Bo | mem_rev1 | codex | 88% | 11 | Best of 2 reviewer candidates: 88% accepted over 11 run(s) at "review". Not on the developer's backend (claude). |
| qa | verify | — | — | — | — | — | No qa member exists in this organisation — add one, or run this stage yourself. |

- No qa member exists in this organisation — add one, or run this stage yourself.

Bullets under the table are the composition's **gaps** — what accepting this team leaves open. A
seat is left empty rather than filled with a member that could not be launched into it: a reviewer
on the developer's backend is refused at launch, so proposing one would only waste the dispatch.

## Decisions
| # | Decision | Chosen | Why | Reversible? |
|---|---|---|---|---|
| 1 | Multi-currency at launch | yes | asked user, they confirmed | no — changes schema |

## Assumptions made without asking
> These went into the run report. Any of them may be overridden — note which nodes
> depend on each, so a reversal re-dispatches only those.

| # | Assumption | Blast radius | Nodes depending on it |
|---|---|---|---|
| 1 | Idempotency keys scoped per merchant | contained | 3, 4 |

## Plan
| Node | Title | Owner | Depends on | Status | Model | Dispatch | Files |
|---|---|---|---|---|---|---|---|
| 1 | orient — map the area | scout | — | done | haiku | ctx_1 | — |
| 2 | backend endpoint | builder | 1 | dispatched | opus | ctx_2 | src/api/refunds.ts |
| 3 | frontend, against contract | builder | 1 | dispatched | opus | ctx_3 | src/ui/refund-form.tsx |
| 4 | review | reviewer — not the author | 2, 3 | pending | codex/sonnet | — | — |

Run status is one of `planning`, `running`, `paused`, `blocked`, `done`, `failed`; node status is
one of `pending`, `dispatched`, `done`, `failed`, `blocked`. Budget and spend are money or `—`. Empty cells are `—`, and
a literal `|` inside a cell is escaped `\|` — `src/main/alicorn/foreman/journal-markdown.ts` reads
this file back, so a hand-written journal has to round-trip.

**Files** is the node's declared footprint: the paths you intend it to touch. It is what the
hidden-dependency check reads, so a node with no Files declared is a node the check cannot protect.

## Waves
> Derived from Plan, not authored — Orca recomputes this from `Depends on` and `Files` on every
> write. Two nodes declaring the same file are not independent, whatever the edges say, so they are
> split into successive waves and the overlap is recorded here.

| Wave | Nodes | Reduced | Overlapping files |
|---|---|---|---|
| 1 | 1 | .foreman/run_alc42/wave-1.md | — |
| 2 | 2, 3 | — | — |
| 3 | 4 | — | — |

`Reduced` is the wave's table: when every node in the wave has settled, a code step folds their
bounded reports into one row per node at `.foreman/<run-id>/wave-<n>.md`. **Read that, not the
reports** — one bounded report is affordable, N of them in a lead's window is context collapse.

## Contract registry
Orca fills this at run start from the repo's OpenAPI documents and shared contract types, and adds
each report's `interface_delta` as a node settles. This is what you paste into a brief — one row,
about 200 tokens, never a transcript. `Provenance` is the column that decides how far to trust a
row: `extracted` was read out of a schema, `⚠ agent-declared` is a subagent's word for it. An
extracted row is never overwritten by a declared one.

A repo under *Schema generation required* is a repo whose interfaces nobody could extract — not a
repo without interfaces. Until what its last column names exists, every entry for it can only be
agent-declared. Prose you write above the tables is kept; Orca only rewrites the tables.

### Interfaces
| Repo | Kind | Name | Shape | Provenance | Source | Breaking? |
|---|---|---|---|---|---|---|
| — | endpoint | POST /refunds/partial | body PartialRefundRequest; → 201 Refund | extracted | openapi.yaml#/paths/~1refunds~1partial/post | no |
| — | type | RefundState | type RefundState = 'pending' \| 'settled' | ⚠ agent-declared | node 3 | no |

### Schema generation required
| Repo | Missing | Must be generated |
|---|---|---|
| billing | no OpenAPI document and no shared contract types found | an OpenAPI document for the HTTP surface, or exported types under contracts/ |

## Log
- `<time>` node 2 dispatched — brief: implement POST /refunds/partial
- `<time>` node 2 done — 14 files, tests green, 1 interface delta
- `<time>` node 4 findings ×2 → back to node 2

## Not done, and why
- <things deliberately left out of scope>
```

---

## Compaction

When your context approaches ~40% of the window: write everything to the journal, then continue
reading only the journal. Do not carry old reports forward — that is what the file is for.

The test of a good journal: **if this session died right now, could a fresh lead pick up from the
file alone?** If not, it is not written down well enough yet.
