# Task composer — minimal action, Claude decides the rest

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Written 2026-09-10.** Spec: the interactive prototype commissioned 2026-09-10 (`docs/alicorn/prototype/`),
as amended in the session that reviewed it. Baseline: `main` at `7522ff5f3`.

**Goal:** Starting a task costs a title and a sentence of context. Everything else — which member,
which backend, which repository, which branch — is decided, shown with its reason, and overridable
behind one disclosure. This is the north-star metric applied to the moment before the work starts:
the fewer decisions a developer makes to begin, the fewer interruptions the run inherits.

**Architecture:** The backend is already there. `alicorn:members:list`, `alicorn:orgPolicy:get`,
`alicorn:workflows:list` and `alicorn:tasks:setExecutionStrategy` are all on the wire
(`src/shared/alicorn/ipc-channels.ts`), and `OrgPolicy.enforceDistinctReviewerBackend` is the real
reviewer rule rather than a prototype invention. So this is renderer work over existing IPC, plus one
pure module that holds the decision itself. **Reuse, do not fork:** the surface is
`NewWorkspaceComposerCard`, which already creates the workspace and launches the agent — the composer
grows an Alicorn section, it does not gain a rival modal.

**Tech Stack:** `src/shared/alicorn/task-composer-plan.ts` (new, pure), `NewWorkspaceComposerCard.tsx`,
`useComposerState`, `window.api.alicorn.listMembers/getOrgPolicy`, vitest.

## Global constraints

- **The planner is pure and returns structured reasons, never sentences.** Renderer strings are
  localised by tooling (`config/scripts/localize-renderer-strings.mjs`); an English sentence baked
  into a shared module fails `verify:localization-coverage` and cannot be translated.
- **Never a guess.** Where the planner cannot resolve something — no repository matched, no reviewer
  on a different backend exists — it says so and leaves the field for the human. It does not pick
  arbitrarily and present it as a decision.
- **The plan is advisory until touched.** The moment the developer overrides any field the planner
  stops adjusting, and the UI says so. A planner that keeps rewriting what you just typed is worse
  than no planner.
- **`execution_strategy: single` stays the default.** Nothing here makes `orchestrated` reachable by
  accident; escalation remains an offer raised by `evaluateEscalationSignal`.
- Cross-platform shortcuts, folder workspaces and SSH hosts respected; no `mode` field; no AI
  attribution in commits.

## Decisions

1. **Member roles carry the binding, not a `joins` field.** The prototype gave each member a stage;
   the real `Member` has `role` (`developer | reviewer | qa | analyst | other`). Author = a
   `developer`; reviewer = a `reviewer`, else a `qa`. No new field is added to the contract for this.
2. **The reviewer rule comes from the org, not from the composer.** `enforceDistinctReviewerBackend`
   decides whether a shared backend is a conflict. With it off, a match is not flagged.
3. **Repository resolution is name-token matching against title + brief, with the composer's current
   repo as the stated fallback.** One repo in the workspace resolves silently; several with no match
   resolves to the open one _and says so_, so the developer can see the choice was weak.
4. **A thin brief is a hint, not a gate.** Under `THIN_BRIEF_CHARS` the UI suggests another sentence;
   it never blocks submission. Nothing invents a spec stage the backend does not model.

## Tasks

### Task 1: the planner — **done**

`src/shared/alicorn/task-composer-plan.ts` — `planTaskComposition(input): TaskComposerPlan`, pure, no
IO, returning `{ authorId, reviewerId, repoIds, reasons, reviewerConflict }` where every reason is a
discriminated union the renderer localises. Tests cover: name-token repo match; single-repo silent
resolve; fallback-with-reason when several repos and no match; reviewer chosen on a different backend;
conflict flagged only when the org enforces it; no-reviewer-available; thin brief.

- [x] Commit `feat(alicorn): task composition planner`.

### Task 2: the composer section — **done**

`NewWorkspaceComposerCard.tsx` grows an Alicorn block under the existing name/repo fields: a context
textarea, the plan line with its reasons, and a disclosure holding member, backend, repository and
branch. Loads members and org policy once through the existing api; renders "—" rather than a guess
when the control plane is unreachable. Pins the plan on first override.

- [x] Localise. Commit `feat(alicorn): the composer proposes a plan and shows why`.

### Task 3: strategy and cost — **withdrawn 2026-09-10, not backed**

Both halves were checked against the code and neither is implementable in the renderer today.

**Execution strategy has nothing to attach to at composer time.** A task is created inside a Run
(`createTaskInRun`, `orchestration-task-internal.ts:26`) by an agent or by board automation, and it
takes `executionStrategy` at creation. The composer creates a _workspace_, not a task, so there is
no task id when the developer would choose. Landing it needs somewhere to park the choice until a
task appears in that workspace's run, plus a main-side read at task creation — backend work, not UI.
The existing surfaces where a task _does_ exist already carry the control: `EscalationOfferToaster`
and `orchestration.taskCreate`.

**The estimate would have to be invented.** `RunCostByDispatch` is keyed by dispatch id and holds
_actuals_ for dispatches that have already run; there is no historical query to size a task that has
not started. `formatRunCostUsd` returns `—` for an unknown, and `summarizeRunCost` marks a total
partial rather than guessing at a missing figure. Fabricating an estimator here would break the one
rule this subsystem exists to keep. If the estimate is wanted, it is a ledger-side feature: a
`step_outcomes` aggregate per project, which is a Ledger API ticket.

### Task 4: import from a PM tool — **already built, 2026-09-10**

Nothing to write. `src/renderer/src/components/task-page/plane/` already ships the whole flow:
`PlaneIssueList` and `PlaneIssueDetail` browse a project's issues, and `usePlaneStartWork` opens the
new-workspace composer with the issue prefilled and its link carried as `linkedWorkItem`. Plane's
settings half exists too — `plane-integration-card.tsx` connects a workspace, lists its projects and
sets the default one.

Because "start work" lands in the same composer, Task 2 improved this path for free: a workspace
started from a Plane issue now gets the plan and its reasons like any other.

The one real gap is narrow and deliberately left open: `SmartNameMode`
(`src/shared/new-workspace/smart-workspace-source-results.ts:20`) has providers for github, gitlab,
linear, jira and branches, but not plane — so a developer already in the composer cannot search Plane
from the name field the way they can search Jira. That is a provider addition across ~8 files
(the mode union, the row union, the hint map, the row builder, the controller, the row surface, a
connection hook, and the composer callback), and it is its own ticket.

## What this plan does not do

The prototype also shows a rail-and-scope IA, a per-project inbox, and a managed MCP registry. Those
are separate slices and separate plans. **`Project` as an entity above the repo was accepted on
2026-09-10** and is not built here: this composer uses the existing repo id as the project id, exactly
as `cloud/apps/control-api/src/project-id-param.ts` documents today, so that the entity migration
lands as its own ticket with its own compatibility read path rather than riding along inside a UI
change.
