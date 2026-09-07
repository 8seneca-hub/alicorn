# Board Automation & Plane Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plane becomes the fifth tracker (read, two-way status sync, worktree linking, settings, CLI verbs), and the board becomes an automation surface: moving a card to a column dispatches a Member through the same task/dispatch path as everything else — with a per-task dispatch ceiling, column-revisit loop detection and a visible kill switch shipping in the same release (ROADMAP v1.0 exit: "Drag a card to In Review; the reviewer picks it up … completes with no human. The merge gate then stops and asks.").

**Architecture:** Plane follows the codebase's *parallel-per-provider* convention (dedicated `src/main/plane/**`, its own IPC/preload bridge, its own renderer hooks and `linkedPlaneIssue*` worktree fields — never a generalised discriminated union). The board rule engine lives in main as an **in-process coordinator**: it owns a *system Run* per project (`coordinator_handle = 'board:<repoId>'`) and calls the same internal functions the `orchestration.taskCreate`/`workerStart` RPC handlers call after their run-scope checks — so every board dispatch is a normal `dispatch_contexts` row with Member provenance, `stage_key` from the column, ledger writes through the outbox, and `execution_strategy: single` by default. Guard rails are state in the orchestration SQLite (transition history + kill-switch flags), not prompts.

**Tech Stack:** Electron main + renderer (React), orchestration SQLite (v32 → v33), Plane REST v1 (`X-API-Key`), `runProcess`-free (pure HTTP), vitest, i18n tooling.

**Spec:** `docs/alicorn/ROADMAP.md` v1.0 (*Board automation*, *Plane provider*, risk *Automation runaway*, sequencing rule 3 *guard rails ship with the feature*); `docs/alicorn/ARCHITECTURE.md` §3 (a run carries provenance), §9 (per-run budgets); `docs/alicorn/PROJECT-BRIEF.md` §03 (Workflows & board), §04 (column change dispatches a member — `single` by default); `CLAUDE.md` *Execution: two axes*; research `research/board-automation-plane-provider.md`. Plane: PP1–PP3, BA1–BA3, WF3-prep (module *Board automation & Plane provider*, owner Nghia).

## Global Constraints

- **Board dispatches carry provenance**: a `dispatch_contexts` row + `alicorn_dispatch_members` (member, backend) + `stage_key` from the column; they flow to the ledger through the outbox unchanged. Never dispatch through `AutomationService`'s headless path (no provenance).
- **`execution_strategy` stays `single` for board dispatches** (CLAUDE.md table); escalation to `orchestrated` only via the D4 offer.
- **Guard rails ship with BA1**: ceiling + loop detection + kill switch are one release, not follow-ups. Defaults: ≤ 3 dispatches per task per 60 min; a task returning to a column it was already dispatched from within 24 h is a loop.
- **Required checks are still authored per project by an admin**, never by the member being judged; the rule engine sets nothing there.
- Plane is desktop-local like the other trackers: credentials in the secret store (`getSecretStore().encryptString`), no tenant scoping in `src/main/plane/**`.
- **Parallel-per-provider convention** for worktree fields (`src/shared/worktree/types.ts:90-97`); i18n by tooling; no `helpers`/`utils` names; additive RPC/IPC changes.
- Verify Plane REST shapes against `https://projects.8seneca.com` **read-only** before writing the client (Task 1 Step 1). Do not commit any API key.
- No AI attribution in commits; toolchain per the desktop ledger.

## Decisions made in this plan

1. **BA1 dispatch path = in-process coordinator with a system Run (research option 1+3 combined).** Extract the handler bodies of `orchestration.taskCreate` and `orchestration.workerStart` into internal functions (`createTaskInRun(runtime, run, input)`, `startWorkerForTask(runtime, run, task, input)`) that the RPC handlers call after `resolveRunScope`, and that the rule engine calls directly with its own system Run. The RPC's authorization is about *which terminal may act on which run*; main's own code is the authority for the board run. The system Run is created lazily per `(repoId)` with `coordinator_handle 'board:<repoId>'` and no pane; `resolveRunScope` is not touched.
2. **Column identity for provenance and stage keys**: `stage_key` = the `WorkspaceStatus` id of the destination column (e.g. `in-review`); `alicorn_board_transitions` records every transition the rule engine acted on.
3. **Rules are per project** (`repoId`): `{ id, repoId, toStatusId, memberId, promptTemplate, enabled }` stored in Orca's regular `Store` (settings-style persistence like automations), edited in a *Board automation* section of the project's settings.
4. **Plane linking fields are dedicated**: `linkedPlaneIssue: string | null` (issue UUID), `linkedPlaneIssueSequence: number | null`, `linkedPlaneWorkspaceSlug`, `linkedPlaneProjectId` — plus `linkedWorkItem` set for the generic consumers.
5. **Status write-back for Plane is a parallel file** (`sync-plane-worktree-status.ts`) matching Plane state `group` first, name second; the Linear file stays untouched.
6. **Plane credential model**: one API key per workspace slug (like Linear's per-workspace token), projects selected per Orca project.
8. **Loop tolerance is one revisit per column, not zero** (decided 2026-09-07, amending Task 11's
   literal wording). The rule is `BOARD_LOOP_MAX_REVISITS = 1`: a second entry into the same column
   inside the loop window is allowed, a third is refused. Task 11 as written ("any prior dispatched
   transition with the same `to_status_id`") refuses the *second* entry, which is the mainline
   correction flow — review returns findings to build, build hands back to review — so it would
   refuse every ticket at its first iteration. The asymmetry decides it: a too-strict rule costs a
   guaranteed interruption on the flow board automation exists to remove, and interruptions are the
   north-star metric; a too-loose one costs tokens, and that cost is already bounded by the
   dispatch ceiling of three per hour. The loop rule guards the *shape*, the ceiling guards the
   *budget*, and the ceiling is the real backstop. Revisit from the ledger if refusals cluster.

11. **The stage and column vocabularies do not match, and binding by key alone is not enough**
    (found 2026-09-07 by running WF3 against the seeded stack). WF4's template keys stages by
    pipeline step — `spec, architecture, design, build, review, verify, merge, deploy` — while the
    board's columns are `todo, in-progress, in-review, completed`. The overlap is empty: `review` is
    not `in-review`, `build` is not `in-progress`. Decision 2 assumed `stage_key` *is* the column id;
    WF4 authored a different vocabulary and nobody reconciled them, so WF3's binding-by-key resolved
    every column to `no-stage`. Amends decision 10: an unstaged column now falls back to the rules
    rather than reading as authored silence, so a naming mismatch degrades instead of taking
    automation down. **The real fix is an explicit column ↔ stage binding**, which is a design
    decision — either stages carry the column they bind to, or the workflow declares the mapping.
    Until then "one model, two views" is true of the data model but not yet of the vocabularies.

10. **Stages are authoritative when a workflow exists; ad-hoc rules are the fallback** (WF3,
    2026-09-07). A stage keyed `in-review` *is* the In review column — the binding is by key, which
    is why WF1 made the wire address stages that way. A stage wins over a rule because it carries
    `reversibility` and `inherited_cost`, which the autonomy policy reads and a rule cannot express;
    the rule still supplies the brief, since WF1 stages carry none. Three cases are deliberately
    distinct: **no workflow** falls back to rules (the degenerate one-stage shape); a workflow that
    **does not stage a column** dispatches nothing, because authoring silence is a decision; and a
    workflow that **cannot be read** refuses rather than falling back, because dispatching then
    means guessing at `reversibility`, which ARCHITECTURE §7 says is authored and never inferred.
    The cache serves a stale workflow only inside its TTL — past it an unreadable control plane
    refuses, since last-known attributes may since have gained a hard stop.

9. **The Plane issue list shipped inside PP1 after all** (recorded 2026-09-07, superseding the
   ALC-98 split made the same day). The list, the detail view and the start-work action that writes
   `linkedPlane*` landed in `3cc3d159e` and `fa0529bcc`; `PlaneStateBadge` is in the sidebar and the
   create payload carries the link fields through to worktree metadata. ALC-98 was filed on stale
   information — the surface existed before the ticket did. The loop PP2 needs is therefore closed:
   an issue can be linked, and a board move writes its state back.

7. **Kill switch scopes**: `global` and `board:<repoId>`; state in SQLite (`alicorn_board_automation_state`), surfaced in the sidebar board header and `alicorn automation stop|resume [--board <repoId>]`.

## File structure

```
src/main/plane/                                  client.ts (fetch + X-API-Key + cursor pagination), plane-token-store.ts, issues.ts, states.ts, comments.ts, projects.ts, plane-identity.ts, html-markdown.ts
src/main/ipc/plane.ts                            IPC handlers (list projects/issues/states, issue detail, comments, update state)
src/preload/api/plane-api.ts, plane-bridge.ts    window.api.plane
src/shared/task-providers.ts, task-provider-identity.ts, task-source-context.ts, default-global-settings.ts, global-settings-types.ts   + 'plane'
src/shared/worktree/types.ts (+ persistence normaliser)   linkedPlane* fields
src/renderer/src/components/use-task-page-provider-state.ts (+ planeX slice), use-task-page-plane-{list-state,list-effects,detail}.ts, task-page/plane/**
src/renderer/src/components/settings/plane-integration-card.tsx, task-tracker-integration-cards.tsx, task-provider-integration-section-ids.ts, TasksPane.tsx
src/renderer/src/components/sidebar/sync-plane-worktree-status.ts (+ test)
src/cli/specs/plane.ts, src/cli/handlers/plane/*.ts, skill-guides/orca-plane.md (→ alicorn-plane.md after the rebrand)
src/main/runtime/rpc/methods/orchestration-task-internal.ts     createTaskInRun (extracted)
src/main/runtime/rpc/methods/orchestration-worker-internal.ts   startWorkerForTask (extracted)
src/main/board-automation/board-rule-store.ts     rules per repo (Store)
src/main/board-automation/board-system-run.ts     ensureBoardRun(db, repoId)
src/main/board-automation/board-rule-engine.ts    onWorkspaceStatusChanged → guard → dispatch
src/main/board-automation/board-guard-rails.ts    ceiling + loop detection (pure) over alicorn_board_transitions
src/main/board-automation/board-kill-switch.ts
src/main/runtime/orchestration/db/schema/migrate-v33-board.ts   alicorn_board_transitions, alicorn_board_automation_state
src/main/runtime/orchestration/db/alicorn/board-transition-methods.ts
src/main/ipc/board-automation-handlers.ts, src/preload/api/board-automation-*.ts
src/renderer/src/components/settings/BoardAutomationSection.tsx; sidebar board header switch
src/cli/specs/automations.ts (+ stop/resume)
```

---

### Task 1 (PP1): Plane REST client, credential store, live shape probe

**Files:** Create `src/main/plane/{client,plane-token-store,plane-identity,projects,states,issues,comments,html-markdown}.ts` + tests; `docs/alicorn/plane-api-notes.md` (probe results).

**Interfaces:**
```ts
export type PlaneWorkspaceIdentity = { workspaceSlug: string; baseUrl: string }   // baseUrl e.g. https://projects.8seneca.com
export type PlaneProjectRef = PlaneWorkspaceIdentity & { projectId: string }
export type PlaneState = { id: string; name: string; group: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'; color: string; sequence: number }
export type PlaneIssue = { id: string; sequenceId: number; name: string; descriptionHtml: string | null; stateId: string; priority: 'urgent' | 'high' | 'medium' | 'low' | 'none'; assigneeIds: string[]; labelIds: string[]; createdAt: string; updatedAt: string }
export type PlanePage<T> = { results: T[]; nextCursor: string | null; totalCount: number }
export function createPlaneClient(deps: { fetch?: typeof fetch; readApiKey: (workspaceSlug: string) => Promise<string | null> }): {
  listProjects(ws: PlaneWorkspaceIdentity): Promise<Array<{ id: string; name: string; identifier: string }>>
  listStates(ref: PlaneProjectRef): Promise<PlaneState[]>
  listIssues(ref: PlaneProjectRef, opts: { cursor?: string; perPage?: number; stateIds?: string[] }): Promise<PlanePage<PlaneIssue>>
  getIssue(ref: PlaneProjectRef, issueId: string): Promise<PlaneIssue>
  updateIssueState(ref: PlaneProjectRef, issueId: string, stateId: string): Promise<void>
  listComments(ref, issueId): Promise<Array<{ id: string; commentHtml: string; actorId: string | null; createdAt: string }>>
  addComment(ref, issueId, commentHtml: string): Promise<void>
}
// Errors: PlaneRequestError(status, code) on non-2xx; 429 honoured with one retry after Retry-After (max 65 s).
// plane-token-store.ts: setPlaneApiKey(workspaceSlug, key) / getPlaneApiKey(slug) / clearPlaneApiKey(slug) via getSecretStore().encryptString — mirror src/main/linear/linear-token-store.ts
// html-markdown.ts: planeHtmlToMarkdown(html), markdownToPlaneHtml(md) — minimal (p, strong, em, code, pre, ul/ol/li, a); tests on fixtures
```
- [x] **Step 1: Probe (read-only):** done 2026-09-07 via the Plane MCP server against `projects.8seneca.com` (no API key handled, no writes). Envelope, state groups, issue field shapes and the bare-array member/project lists are confirmed in `docs/alicorn/plane-api-notes.md`; the two things still unobserved (comment body field on a populated list, and the 429 body) are marked ⚠ there. The client needed no changes — `mapPlaneState` already reads `default` rather than `is_default`, and `mapPlaneIssue` already matches the live detail shape.
- [ ] **Step 2: Failing tests** with a fake `fetch`: header `X-API-Key`, pagination follows `next_cursor` until `next_page_results === false`, 429 retry, 401 → `PlaneRequestError(401, 'unauthorized')`; token store round-trip; html↔markdown fixtures.
- [ ] **Step 3: Implement. Step 4:** `corepack pnpm test src/main/plane`, `pnpm tc:node`. **Step 5: Commit** `feat(plane): REST client, API-key store, HTML/Markdown bridge`.

---

### Task 2 (PP1): Provider plumbing — union, identity, settings

**Files:** `src/shared/task-providers.ts` (`'plane'`; `isTaskProviderAvailable` branch on `availability.planeConnected`), `task-provider-identity.ts` (`PlaneTaskProviderIdentity = { provider: 'plane'; workspaceSlug; projectId }` in the three switches + `TASK_PROVIDER_IDENTITY_FIELDS`), `task-source-context.ts` (`normalizeTaskProvider`), `default-global-settings.ts` + `global-settings-types.ts` (`plane: { baseUrl: string; workspaceSlug: string | null; visible: boolean; defaultProjectId: string | null }`), tests extended (`task-providers.test.ts`, identity tests).
- [ ] Failing tests → implement → `pnpm tc:node && pnpm tc:web`. Commit `feat(plane): task provider plumbing (union, identity, settings)`.

---

### Task 3 (PP1): IPC + preload bridge

**Files:** `src/main/ipc/plane.ts` (channels `plane:setApiKey`, `plane:clearApiKey`, `plane:listProjects`, `plane:listStates`, `plane:listIssues`, `plane:getIssue`, `plane:listComments`, `plane:addComment`, `plane:updateIssueState`; registered from `register-core-handlers.ts` — additive one-liner), `src/preload/api/plane-api.ts` (`PlaneApi` type), `plane-bridge.ts`, `src/preload/index.ts` + `api-types.ts` (additive), `src/main/ipc/plane.test.ts` (fake ipcMain, fake client), channel-parity test mirroring `github-ipc-channel-parity.test.ts`.
- [ ] Commit `feat(plane): IPC handlers and preload bridge`.

---

### Task 4 (PP1): Task page — list, detail, availability

**Files:** `use-task-page-provider-state.ts` (+ `plane` slice: `planeProjects`, `planeStates`, `planeIssues`, `planeCursor`, `planeLoading`, `planeError`, `planeSelectedIssue`), `use-task-page-plane-list-state.ts`, `use-task-page-plane-list-effects.ts` (load projects/states/issues; filters by state group; pagination "load more"), `task-page/plane/PlaneIssueList.tsx`, `PlaneIssueDetail.tsx` (title, sequence `PROJ-123`, state chip by `group`, description via `planeHtmlToMarkdown`, comments), `task-source-provider-availability.ts` (+ plane), `use-task-page-source-availability.ts`, tests mirroring `task-page-gitlab-task-filters.test.ts`.
- [ ] Plain English strings → localise (`node config/scripts/localize-renderer-strings.mjs && pnpm run sync:localization-catalog`), `verify:localization-*`; `pnpm tc:web`. Commit `feat(plane): task page — projects, issue list, detail`.

---

### Task 5 (PP3): Settings card + Tasks pane label

**Files:** `plane-integration-card.tsx` (base URL, workspace slug, API key input → `plane:setApiKey`, connection test = `listProjects`, default project select), `task-tracker-integration-cards.tsx`, `task-provider-integration-section-ids.ts` (`PLANE_INTEGRATION_SECTION_ID`), `IntegrationsPane.tsx`, `TasksPane.tsx` label switch; `plane-integration-card.test.tsx`.
- [ ] Localise; `pnpm tc:web`. Commit `feat(plane): integration settings card`.

---

### Task 6 (PP2): Worktree linking

**Files:** `src/shared/worktree/types.ts` (+ `linkedPlaneIssue`, `linkedPlaneIssueSequence`, `linkedPlaneWorkspaceSlug`, `linkedPlaneProjectId`, all optional/nullable — follow the `linkedGitLabIssue` comment block), the persistence normaliser (grep `linkedGitLabIssue` in `src/main/persistence*` and mirror), `launch-work-item-direct-types.ts` (`planeIssueId`, `planeProjectId`, `planeWorkspaceSlug` on `LaunchableWorkItem`), the "start work on this issue" action in `PlaneIssueDetail.tsx` (creates a worktree with `linkedPlane*` set and `linkedWorkItem = { type: 'issue', provider: 'plane', … }`), sidebar badge (`WorktreeCardMetadataStatusBadges.tsx` — a `PlaneStateBadge` next to `LinearStateBadge`).
- [ ] Persistence round-trip test; badge render test. Commit `feat(plane): link worktrees to Plane issues`.

---

### Task 7 (PP2): Status write-back

**Files:** Create `src/renderer/src/components/sidebar/sync-plane-worktree-status.ts` + test; modify `workspace-board-task-status-sync.ts` only to call `syncPlaneWorktreeStatus` for worktrees with `linkedPlaneIssue` (one branch, alongside Linear).
```ts
export async function syncPlaneWorktreeStatus(input: { worktree: Worktree; targetStatus: WorkspaceStatus; states: PlaneState[]; getLatestWorkspaceStatus: (id) => string | null; updateIssueState: (ref, issueId, stateId) => Promise<void> }): Promise<'updated' | 'already' | 'ambiguous' | 'stale'>
// mapping: WorkspaceStatus.kind/label → Plane state: group match first (todo→unstarted, in-progress→started, in-review→started+name~/review/i, completed→completed), then unique name match; 0 or 2+ candidates → 'ambiguous' (never guess); re-check getLatestWorkspaceStatus before writing → 'stale'
```
- [ ] Tests mirror `workspace-board-task-status-sync.test.ts`. Commit `feat(plane): board drag writes the issue state back to Plane`.

---

### Task 8 (PP3): CLI verbs + skill guide

**Files:** `src/cli/specs/plane.ts` (`orca plane issue <id|PROJ-123>`, `orca plane search --project <id> [--state <group>] [--query <text>]`, `orca plane comment <id> --body <md>`, `orca plane state <id> --to <state-name>`; flags via `GLOBAL_FLAGS`), `src/cli/handlers/plane/*.ts` (RPC methods `plane.issue`, `plane.search`, `plane.comment`, `plane.setState` in a new `src/main/runtime/rpc/methods/plane.ts` calling the client in main), `skill-guides/orca-plane.md` (mirrors `orca-linear.md`), regenerate `pnpm run generate:bundled-skill-guides`; spec tests.
- [x] Commit `feat(plane): CLI verbs and skill guide`.

**As built** — four deviations from the sketch, each for a reason:
- `plane state` reuses the existing `plane.updateIssueState` mutation rather than
  adding a `plane.setState` write. The new `plane.setState` RPC resolves a state
  *name* to an id and then calls it — CLI callers name a column, the UI already
  holds uuids.
- `plane issue` also returns the issue's comments, since reading an issue without
  them is rarely what an agent wants; `listIssueComments` is new alongside
  `addIssueComment`.
- A readable id (`ALC-11`) resolves by project key + running number. A bare uuid
  requires `--project`: Plane's detail route is project-scoped and there is no
  workspace-wide issue lookup, so the alternative is scanning every project.
- `--state` on `search` filters on the state **group**, not the name. Plane CE has
  no server-side filtering, so the project's issues are read once and narrowed
  locally rather than sending query parameters the server ignores.

**Known gap:** `search` reads a whole project before narrowing, so `--limit` caps
the output but not the fetch. A large project pays the full page walk each call.

---

### Task 9 (BA1-prep): Extract internal task/worker functions

**Files:** Create `src/main/runtime/rpc/methods/orchestration-task-internal.ts` (`createTaskInRun(runtime, run: RunRow, input: { spec; taskTitle?; displayName?; deps?; parent?; executionStrategy? }): TaskRow` — the body of the `taskCreate` handler after run resolution) and `orchestration-worker-internal.ts` (`startWorkerForTask(runtime, run, task, input: WorkerStartInput minus run/from, opts: { creator: DispatchCreator; memberLaunch?: … }): Promise<WorkerStartResult>` — the body of `workerStart` after `resolveRunScope`/authority checks); the RPC handlers become thin wrappers. Behaviour-preserving refactor: the existing tests in `orchestration-tasks-dispatch.test.ts`, `orchestration-workers*.test.ts`, `orchestration-worker-start-*.test.ts` must pass unchanged.
- [ ] Commit `refactor(orchestration): extract task creation and worker start internals for in-process callers`.

---

### Task 10 (BA1+BA2 storage): SQLite v33

**Files:** `contract-constants.ts` (33), `schema/migrate-v33-board.ts`, `db/alicorn/board-transition-methods.ts` + tests.
```sql
CREATE TABLE IF NOT EXISTS alicorn_board_transitions (
  id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, worktree_id TEXT NOT NULL, task_id TEXT, dispatch_id TEXT,
  from_status_id TEXT, to_status_id TEXT NOT NULL, rule_id TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('dispatched','refused_ceiling','refused_loop','refused_killed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_board_transitions_worktree ON alicorn_board_transitions(worktree_id, created_at);
CREATE TABLE IF NOT EXISTS alicorn_board_automation_state (scope TEXT PRIMARY KEY, disabled_at TEXT, disabled_by TEXT);
```
Methods: `recordBoardTransition(row)`, `listBoardTransitions(worktreeId, sinceIso)`, `getBoardAutomationState(scope)`, `setBoardAutomationDisabled(scope, disabledBy | null)`.
- [ ] Commit `feat(board-automation): transition history and kill-switch state (SQLite v33)`.

---

### Task 11 (BA2): Guard rails (pure)

**Files:** Create `src/main/board-automation/board-guard-rails.ts` + test.
```ts
export const BOARD_DISPATCH_CEILING = { max: 3, windowMs: 3_600_000 }
export const BOARD_LOOP_WINDOW_MS = 86_400_000
export type GuardVerdict = { allow: true } | { allow: false; reason: 'ceiling' | 'loop' | 'killed'; detail: string }
export function evaluateBoardGuard(input: { now: number; transitions: BoardTransitionRow[] /* this worktree, recent */; toStatusId: string; killed: boolean }): GuardVerdict
// ceiling: count outcome='dispatched' within windowMs ≥ max → ceiling
// loop: any prior 'dispatched' transition with the same to_status_id within BOARD_LOOP_WINDOW_MS → loop
```
- [ ] Tests for each branch and the allow path. Commit `feat(board-automation): dispatch ceiling and column-revisit loop detection`.

---

### Task 12 (BA1): Rule store, system Run, rule engine

**Files:** Create `board-rule-store.ts` (rules in `Store` settings: `boardAutomation: { rules: BoardRule[] }` per repo; `BoardRule = { id; repoId; toStatusId; memberId; promptTemplate: string; enabled: boolean }`), `board-system-run.ts` (`ensureBoardRun(db, repoId): RunRow` — `runs` row with `coordinator_handle 'board:<repoId>'`, created once), `board-rule-engine.ts`:
```ts
export function createBoardRuleEngine(deps: { runtime; getDb; rules: BoardRuleStore; memberDirectory: MemberDirectory /* from D2 */; now?: () => number }): { onWorkspaceStatusChanged(ev: { worktreeId; repoId; fromStatusId: string | null; toStatusId: string; worktreePath: string }): Promise<GuardVerdict | { allow: true; dispatchId: string }> }
// flow: rule for (repoId, toStatusId) enabled? → killed = global or board scope disabled → evaluateBoardGuard → record refusal or:
//   run = ensureBoardRun; task = createTaskInRun(runtime, run, { spec: renderTemplate(rule.promptTemplate, { worktree, issue: linkedWorkItem }), executionStrategy: 'single' });
//   startWorkerForTask(runtime, run, task, { worktree: `id:${worktreeId}`, member: rule.memberId, from: run.coordinator_handle }) → db.setDispatchMember(...) is done by D2's member launch; stage_key: the drainer's step-outcome builder reads `phase` — the rule engine passes `--phase <toStatusId>`? No: set task.spec header `phase: <toStatusId>` is fragile → add `stageKey` to alicorn_task_strategy? Decision: new column on alicorn_board_transitions is not read by the drainer; instead the rule engine writes `db.setTaskExecutionStrategy` unchanged and the step-outcome builder (C3) reads the latest board transition for the task to derive stage_key when the worker report carries no phase. Document in OWNERSHIP seams (Huy edits the builder: one lookup).
//   recordBoardTransition({ outcome: 'dispatched', dispatch_id })
```
Wire: subscribe to the workspace-status change event in main (find where `WorkspaceStatus` updates are persisted — `persistence` worktree status setter — and emit an event; additive).
- [ ] Tests: rule matches → task + dispatch created with member; no rule → nothing; guard refusal → recorded, no dispatch; killed → refused. Commit `feat(board-automation): column transitions dispatch members through the orchestration path`.

---

### Task 13 (BA3): Kill switch — UI + CLI

**Files:** `board-kill-switch.ts` (`isBoardAutomationKilled(db, repoId)`, `setKilled(db, scope, by)`), `src/main/ipc/board-automation-handlers.ts` (`boardAutomation:getState`, `setKilled`, `listRules`, `saveRules`, `listTransitions`), preload `board-automation-api.ts`/`-bridge.ts`, renderer: `BoardAutomationSection.tsx` in the project settings (rules editor: column → member → prompt template; enable) and a **visible** switch in the sidebar board header ("Automation: on/off" with the last refusal reason), `src/cli/specs/automations.ts` (+ `orca automation stop [--board <repoId>]`, `orca automation resume [--board <repoId>]`) + handlers via RPC `boardAutomation.setKilled`.
- [ ] Tests: IPC handlers; CLI spec; component test for the header switch. Localise. Commit `feat(board-automation): visible kill switch (global and per board), rules editor, CLI stop/resume`.

---

### Task 14 (WF3-prep + docs): leave room for stages; document

**Files:** `docs/alicorn/ARCHITECTURE.md` §3/§7 (board rule = a degenerate one-stage workflow; `to_status_id` becomes `stage_key` when workflows land — WF3), `docs/alicorn/OWNERSHIP.md` seams (+ stage_key derivation from board transitions in the step-outcome builder), `docs/alicorn/plane-api-notes.md` finalised.
- [x] Commit `docs(alicorn): board automation model and Plane provider notes`.

**Found while writing it:** `to_status_id` never reaches `step_outcomes.stage_key`. The builder
derives `stage_key` from the worker's `--phase` and defaults to `'build'`; the rule engine passes
the column into the prompt template instead. Every board dispatch therefore records
`stage_key: 'build'`, which undercuts decision 2 above and mixes reviewer track record into
implementation work in `member_stage_stats`. Documented as an open seam in OWNERSHIP rather than
fixed here — the change belongs on the ledger side.

---

## Self-review

- **Coverage.** PP1 (Tasks 1–4), PP2 (6, 7), PP3 (5, 8), BA1 (9, 10, 12), BA2 (10, 11 — same release), BA3 (13), WF3-prep (14). ROADMAP v1.0 exit criterion path: drag → rule → dispatch → reviewer member → `worker_done` → ledger; the merge gate itself is the gates plan.
- **Placeholders.** Task 12 states the `stage_key` derivation decision explicitly (builder reads the board transition) instead of leaving it open; the live-instance probe is a step with a recorded artefact.
- **Types.** `PlaneState.group` values match Plane's enum and the write-back mapping; `BoardRule.toStatusId` = `WorkspaceStatus.id` used by transitions and the guard; `createTaskInRun`/`startWorkerForTask` signatures are shared by the RPC wrappers and the engine.
- **Order.** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (Plane), then 9 → 10 → 11 → 12 → 13 → 14 (board). Board work needs D2 (`--member` launch) on `main`.
