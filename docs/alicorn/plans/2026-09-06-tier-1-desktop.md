# Tier 1 — Desktop (Members · Ledger writes · Tier-1 policies and signals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop sign in through the Alicorn control plane, manage Members, write every settled step to the Ledger exactly once, and ship the six tier-1 items: `execution_strategy` + escalation offer, PR body from provenance, context capture, diff-coverage required check, reviewer ≠ author backend, and per-run cost surfaced while working.

**Architecture:** No local store for Alicorn data — the desktop talks to the Control API and Ledger API (companion plan `2026-09-06-tier-1-control-plane.md`) in auth mode `local`: a shared bearer (`ALICORN_LOCAL_API_TOKEN`) and a constant tenant (`ALICORN_TENANT_ID`) read from the desktop's environment. Identity (Keycloak) is deferred; when it lands, only `readAlicornBearer` changes. The only local addition is a `ledger_outbox` table in Orca's existing orchestration SQLite, written inside the same transaction that settles a `worker_done`, and drained to the Ledger API by a background drainer (exactly-once end to end). Policies (reviewer backend) and signals (context ceiling, cost) plug into the existing `orchestration.*` RPC handlers and Orca's existing Claude/Codex usage stores; nothing new is invented where Orca already has the mechanism.

**Tech Stack:** Electron main (Node 24), React renderer, zod 4 (root), vitest (`pnpm test <file>`), oxlint, existing `src/main/runtime/orchestration/db` SQLite (`node:sqlite`-style sync API: `prepare().run/get/all`, `exec`, `pragma`), existing `src/main/claude-usage` / `src/main/codex-usage` stores, `runProcess` from `src/shared/child-process/run-process.ts`, `gitExecFileAsync` from `src/main/git/command-runner/git-exec-file.ts`.

**Spec:** `docs/alicorn/PROJECT-BRIEF.md` §04 (two axes), §08 (first slice), §09 (gates), §11.4 (reviewer backend decision); `docs/alicorn/ARCHITECTURE.md` §6 (ledger rules); `CLAUDE.md` → *Tier 1*, *Control plane*, *Execution: two axes*; `AGENTS.md` (conventions below).

## Global Constraints

- **Ledger writes only through the outbox** (CLAUDE.md). Never `fetch` the Ledger API from a settlement path.
- **`single` stays the default `execution_strategy`; escalation is offered, never applied** (PROJECT-BRIEF §04).
- **Reviewer ≠ author backend enforced by default, explicit opt-out, bypass recorded** (§11.4). If the org policy cannot be fetched, **enforce** (fail closed).
- **Required checks are never authored by the member being judged** — the desktop only *runs* checks fetched from `GET /v1/projects/:projectId/required-checks`.
- **Additive wire changes only**: new RPC params are optional; new IPC channels are new names; no stream opcodes.
- AGENTS.md: Windows child processes only via `runProcess`/`spawnProcess`; consider SSH hosts (usage attribution is local-only → report `unavailable`, never guess); consider folder workspaces (no git → diff coverage `skipped`, not `error`); GitLab/Bitbucket/Azure/Gitea PRs get the same provenance section as GitHub; no `helpers`/`utils` file names; concise *why* comments only; never disable `max-lines`.
- Renderer strings: write plain English, then `node config/scripts/localize-renderer-strings.mjs && pnpm run sync:localization-catalog`; verify with `pnpm run verify:localization-extraction && pnpm run verify:localization-coverage`.
- Existing env/ids keep `ORCA_*` names; new ones are `ALICORN_*` / `alicorn:*` (IPC) / `alicorn_*` (SQLite tables).
- Verify each task with `pnpm test <file>`, `pnpm tc:node` (main/shared/preload), `pnpm tc:web` (renderer), `pnpm run check:code-quality:changed`.
- No AI attribution in commits.

## Decisions made in this plan

1. **Outbox in the existing orchestration SQLite** — `ledger_outbox` + `alicorn_task_strategy` + `alicorn_dispatch_members`, schema version 30 → 31. Transport and small per-task flags only; Postgres is the system of record.
2. **Stage key comes from `worker_done --phase`**, defaulting to `build`. `phase` is added to the settlement `result` JSON (additive).
3. **Author backends for the reviewer rule come from the task's `deps`**: the reviewer task's dependency tasks' completed dispatches carry the author agents.
4. **Cost attribution reuses `ClaudeUsageStore.getAutomationRunUsage` / `CodexUsageStore.getAutomationRunUsage`** with `{ worktreeId, terminalSessionId: null, startedAt: dispatched_at, completedAt }`. Other backends → `unavailable`, shown as "—".
5. **Context ceiling is detected for Claude Code sessions only in tier 1** (tail of the session transcript: `input + cache_read + cache_creation` tokens of the last assistant turn ≥ 300 000). Multi-repo detection lands with the multi-repo feature workspace (v2.0).
6. **PR provenance is appended main-side in the `hostedReview:create` IPC handler**, so every forge provider gets it and the template still applies (we read the template ourselves when the body is empty and `useTemplate` is set).
7. **Auth is deferred (user decision 2026-09-06).** The bearer and tenant come from `ALICORN_LOCAL_API_TOKEN` / `ALICORN_TENANT_ID` in the main process environment. The worker terminals never receive the token — only main talks to the control plane.

## File structure

```
src/shared/alicorn/
  members.ts                         Member types + enums (mirror of the contract; zod 4)
  ipc-channels.ts                    ALICORN_IPC channel names + event names
  run-cost.ts                        RunCostByDispatch type, formatRunCostUsd()
  context-ceiling.ts                 ALICORN_CONTEXT_CEILING_TOKENS = 300_000
src/main/alicorn/
  control-plane-urls.ts              getAlicornControlPlaneUrls(env)
  control-plane-session.ts           readAlicornBearer(env): { accessToken, orgId } | null   (local mode; Keycloak later)
  control-plane-http.ts              alicornFetch(service, path, init), ControlPlaneRequestError, ControlPlaneUnavailableError
  control-plane-client.ts            createControlPlaneClient(): members/org policy/required checks + getProvenance/getRunCost, over alicornFetch
  member-directory.ts                cached member list / org policy / required checks (60 s TTL)
  review-backend-policy.ts           evaluateReviewBackend(...) pure
  author-backends.ts                 getAuthorBackendsForTask(db, taskId)
  worker-member-launch.ts            resolveWorkerMemberLaunch(...) — glue for workerStart/dispatch
  ledger/ledger-writer.ts            createLedgerWriter(): LedgerWriter — ledger writes, over alicornFetch only
  ledger-outbox-drainer.ts           drains ledger_outbox → Ledger API
  step-outcome-builder.ts            buildStepOutcomeInput(db, runtime, row) pure-ish
  run-usage-attribution.ts           attributeDispatchUsage({ claudeUsage, codexUsage, backend, ... })
  context-ceiling-watcher.ts         periodic; publishes alicorn:escalationOffer
  transcript-context-tail.ts         contextTokensFromTranscriptTail(text) pure
  diff-coverage/lcov-parser.ts       parseLcov(text)
  diff-coverage/unified-diff-added-lines.ts
  diff-coverage/diff-coverage.ts     computeDiffCoverage(added, covered)
  diff-coverage/diff-coverage-check.ts   runDiffCoverageCheck({ worktreePath, baseRef, check })
  diff-coverage/required-checks-fetch.ts   fetchRequiredChecks(projectId), over alicornFetch only
  provenance-markdown.ts             renderProvenanceMarkdown(report), composeReviewBody(...)
  run-cost-publisher.ts              periodic; publishes alicorn:runCost
src/main/runtime/orchestration/db/schema/
  create-alicorn-tables-sql.ts       ledger_outbox, alicorn_task_strategy, alicorn_dispatch_members
  migrate-v31-alicorn.ts
src/main/runtime/orchestration/db/alicorn/
  ledger-outbox-methods.ts           enqueueLedgerOutbox, listDueLedgerOutbox, markLedgerOutboxSent/Failed
  task-strategy-methods.ts           getTaskExecutionStrategy, setTaskExecutionStrategy, markEscalation*
  dispatch-member-methods.ts         setDispatchMember, getDispatchMember
src/main/ipc/alicorn-handlers.ts     registerAlicornHandlers(...)
src/preload/api/alicorn-bridge.ts, alicorn-api.ts                    (Members + escalation offer only)
src/preload/api/alicorn-run-cost-bridge.ts, alicorn-run-cost-api.ts  (D7's own bridge: window.api.alicornRunCost.onChanged)
src/renderer/src/components/settings/AlicornMembersPane.tsx, alicorn-members-search.ts, settings-alicorn-section-renderers.tsx
src/renderer/src/store/slices/alicorn-run-cost.ts (or a hook) + chip in worktree-card-compact-agent-row.tsx
src/renderer/src/components/alicorn/EscalationOfferToaster.tsx
```

---

### Task 1 (B1): Local control-plane configuration (env) and LOCAL-DEV.md

**Files:**
- Create: `src/main/alicorn/control-plane-urls.ts`, `src/main/alicorn/control-plane-session.ts`, `src/main/alicorn/control-plane-http.ts`
- Create: `docs/alicorn/LOCAL-DEV.md` (how to run desktop + local stack)
- Test: `src/main/alicorn/control-plane-urls.test.ts`, `src/main/alicorn/control-plane-session.test.ts`, `src/main/alicorn/control-plane-http.test.ts`

**Interfaces:**
- `getAlicornControlPlaneUrls(env: NodeJS.ProcessEnv): { controlApiUrl: string; ledgerApiUrl: string } | null` — `controlApiUrl = ALICORN_CONTROL_API_URL`; `ledgerApiUrl = ALICORN_LEDGER_API_URL ?? controlApiUrl`; both trimmed of trailing slashes and must parse as `http(s)` URLs; `null` when `ALICORN_CONTROL_API_URL` is unset or invalid.
- `readAlicornBearer(env: NodeJS.ProcessEnv): { accessToken: string; orgId: string } | null` — `accessToken = ALICORN_LOCAL_API_TOKEN` (≥ 16 chars, else `null`), `orgId = ALICORN_TENANT_ID ?? 'local'`. Why a function and not two constants: the Keycloak plan replaces its body with the Orca Cloud session lookup and nothing else in the desktop changes.
- `alicornFetch(service: 'control' | 'ledger', path: string, init?: RequestInit): Promise<Response>` (`control-plane-http.ts`, reads `process.env` through the two functions above) — resolves the base URL from `getAlicornControlPlaneUrls` (`'control'` → `controlApiUrl`, `'ledger'` → `ledgerApiUrl`) and the bearer from `readAlicornBearer`; adds `authorization: Bearer <accessToken>`, `x-alicorn-org: <orgId>`, `content-type: application/json`, `AbortSignal.timeout(15_000)`, `redirect: 'error'`. Throws `ControlPlaneUnavailableError('control_plane_unconfigured')` when urls or bearer are missing; throws `ControlPlaneRequestError(status, code)` on a non-2xx response (`code` from the JSON body's `error` field when present, else the status text). Both error classes are defined in this file. It is the only thing any other desktop module imports to reach the control plane — B2 and C3 both build on it and neither imports the other.

- [ ] **Step 1: Failing tests** — urls: env precedence, ledger defaulting to control, `null` on missing/invalid (`'not a url'`); bearer: default tenant `local`, `null` on a 5-char token; http: fake `fetch` records `authorization` and `x-alicorn-org`; non-2xx → `ControlPlaneRequestError` with `code` from the body's `error`; missing env → `ControlPlaneUnavailableError`.
- [ ] **Step 2: Run** `pnpm test src/main/alicorn` → FAIL (modules missing). **Step 3: Implement.** **Step 4:** PASS; `pnpm tc:node`.
- [ ] **Step 5: Write `docs/alicorn/LOCAL-DEV.md`**: prerequisites (Node 24 via nvm, pnpm via corepack, Docker), `cd cloud && pnpm alicorn:up && pnpm alicorn:seed`, `source cloud/dev/compose/desktop.env.example`, `pnpm dev`, expected result (Settings → Workflows → Members lists three seeded members). Link it from `docs/alicorn/README.md`.
- [ ] **Step 6: Commit** `feat(alicorn): local control-plane configuration and dev guide`.

---

### Task 2 (B2): Control-plane client in main

**Files:**
- Create: `src/main/alicorn/control-plane-client.ts`, `src/shared/alicorn/members.ts`, `src/shared/alicorn/ledger.ts`
- Test: `src/main/alicorn/control-plane-client.test.ts`

**Interfaces:**
- `src/shared/alicorn/members.ts`:
```ts
export const MEMBER_BACKENDS = ['claude', 'codex', 'grok', 'openclaude'] as const
export const MEMBER_ROLES = ['developer', 'reviewer', 'qa', 'analyst', 'other'] as const
export const WORKSPACE_KINDS = ['worktree', 'folder'] as const
export const PERMISSION_MODES = ['ask', 'accept_edits', 'yolo'] as const
export type MemberBackend = (typeof MEMBER_BACKENDS)[number]
export type MemberRole = (typeof MEMBER_ROLES)[number]
export type MemberInput = { name: string; role: MemberRole; backend: MemberBackend; workspaceKind: (typeof WORKSPACE_KINDS)[number]; permissionMode: (typeof PERMISSION_MODES)[number]; systemRules: string; skills: string[] }
export type Member = MemberInput & { id: string; tenantId: string; createdBy: string; createdAt: string; updatedAt: string }
export type OrgPolicy = { enforceDistinctReviewerBackend: boolean }
export type DiffCoverageCheck = { kind: 'diff_coverage'; threshold: number; lcovPath: string; command?: string; timeoutMs: number }
export type RequiredCheck = DiffCoverageCheck
```
- Built on B1's `alicornFetch` — no separate `fetch`/`urls`/`getBearer` plumbing here, and no error classes defined here (`ControlPlaneRequestError`/`ControlPlaneUnavailableError` live in B1; this file re-exports neither).
- `createControlPlaneClient(deps?: { fetch?: typeof alicornFetch }): ControlPlaneClient` with:
  - `listMembers(): Promise<Member[]>`, `createMember(input): Promise<Member>`, `updateMember(id, input): Promise<Member>`, `deleteMember(id): Promise<void>`
  - `getOrgPolicy(): Promise<OrgPolicy>`, `getRequiredChecks(projectId): Promise<RequiredCheck[]>`
  - `getProvenance(repoId, branch): Promise<ProvenanceReport>`, `getRunCost(runId): Promise<RunCost>` — B2's two ledger *reads*; the ledger *writes* (`postStepOutcome` and friends) move to C3's own writer (Task 7), which this client no longer exposes.
  - Every call goes through `alicornFetch('control', …)` (members/policy/checks) or `alicornFetch('ledger', …)` (`getProvenance`/`getRunCost`); errors surface exactly as `alicornFetch` throws them. Define the read-side types (`ProvenanceReport`, `RunCost`) in `src/shared/alicorn/ledger.ts` (hand-mirrored from the contract package; keep field names identical).
- [ ] **Step 1: Failing tests** — client: fake `alicornFetch` records `service`/`path`/method/headers/body for `createMember`, maps 201 body to `Member`; a 403 `{ error: 'not_a_member' }` throws `ControlPlaneRequestError` with `code 'not_a_member'`; a fake `alicornFetch` that throws `ControlPlaneUnavailableError` propagates unchanged.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `pnpm tc:node`. **Step 5: Commit** `feat(alicorn): typed control-plane client`.

---

### Task 3 (B3): Members IPC + preload bridge

**Files:**
- Create: `src/shared/alicorn/ipc-channels.ts`, `src/main/ipc/alicorn-handlers.ts`, `src/preload/api/alicorn-api.ts`, `src/preload/api/alicorn-bridge.ts`
- Modify: `src/preload/index.ts` (add `alicorn: alicornApi` to the `api` object next to `orcaProfiles`), `src/preload/api-types.ts` (`alicorn: AlicornApi`), `src/main/ipc/register-core-handlers/register-core-handlers.ts` (call `registerAlicornHandlers(...)` right after `registerOrcaProfileHandlers(...)`)
- Test: `src/main/ipc/alicorn-handlers.test.ts`

**Interfaces:**
```ts
// src/shared/alicorn/ipc-channels.ts
export const ALICORN_IPC = {
  membersList: 'alicorn:members:list',
  membersCreate: 'alicorn:members:create',
  membersUpdate: 'alicorn:members:update',
  membersDelete: 'alicorn:members:delete',
  orgPolicyGet: 'alicorn:orgPolicy:get',
  tasksSetExecutionStrategy: 'alicorn:tasks:setExecutionStrategy'
} as const
export const ALICORN_EVENTS = { escalationOffer: 'alicorn:escalationOffer' } as const
```
```ts
// src/preload/api/alicorn-api.ts
export type AlicornApi = {
  listMembers: () => Promise<{ ok: true; members: Member[] } | { ok: false; error: string }>
  createMember: (input: MemberInput) => Promise<{ ok: true; member: Member } | { ok: false; error: string }>
  updateMember: (id: string, input: MemberInput) => Promise<{ ok: true; member: Member } | { ok: false; error: string }>
  deleteMember: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  getOrgPolicy: () => Promise<{ ok: true; policy: OrgPolicy } | { ok: false; error: string }>
  setTaskExecutionStrategy: (args: { taskId: string; strategy: 'single' | 'orchestrated'; source: 'user' | 'escalation' }) => Promise<{ ok: boolean }>
  onEscalationOffer: (cb: (payload: EscalationOffer) => void) => () => void
}
```
- `registerAlicornHandlers(deps: { client: ControlPlaneClient | null; getOrchestrationDb: () => OrchestrationDb })` — each handler wraps the client call and maps `ControlPlaneUnavailableError` (or a null client) → `{ ok: false, error: 'control_plane_unconfigured' }`, `ControlPlaneRequestError` → `{ ok: false, error: code }`. `setTaskExecutionStrategy` writes `alicorn_task_strategy` (Task C1) and, for `source: 'escalation'`, `markEscalationAccepted(taskId)`.
- Bridge: `ipcRenderer.invoke(ALICORN_IPC.membersList)` etc.; `onEscalationOffer` = `ipcRenderer.on(ALICORN_EVENTS.escalationOffer, listener)` returning an unsubscribe, exactly like `orcaProfilesApi.onAuthStatusChanged`. Per-run cost has its own bridge now (Task 16/D7): `window.api.alicorn` carries `onEscalationOffer` only.

- [ ] **Step 1: Failing test** — register handlers against a fake `ipcMain` (capture `handle(channel, fn)`), fake client; `membersList` → `{ ok: true, members }`; client throwing `ControlPlaneUnavailableError` → `{ ok: false, error: 'control_plane_unconfigured' }`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire** (in `register-core-handlers.ts`, construct the client once: `const client = createControlPlaneClient()` — B1's `alicornFetch` already reads env on each call, so there is no `urls`/`getBearer` to plumb through here; export the instance from a tiny `src/main/alicorn/control-plane-client-instance.ts` so the hosted-review handler (Task 15/D6) reuses it). **Step 4:** `pnpm test src/main/ipc/alicorn-handlers.test.ts && pnpm tc:node` → PASS. **Step 5: Commit** `feat(alicorn): Members IPC and preload bridge`.

---

### Task 4 (B4): Members settings pane

**Files:**
- Create: `src/renderer/src/components/settings/AlicornMembersPane.tsx`, `src/renderer/src/components/settings/alicorn-members-search.ts`, `src/renderer/src/components/settings/settings-alicorn-section-renderers.tsx`
- Modify: `src/renderer/src/hooks/settings-navigation-workflow-sections.ts` (new section after `automations`), `src/renderer/src/components/settings/settings-page-renderer.tsx` (render after `renderAutomationsSettingsSection(context)`)
- Test: `src/renderer/src/components/settings/AlicornMembersPane.test.tsx`

**Interfaces:**
- Nav section: `{ id: 'alicorn-members', title: 'Members', description: 'Reusable agent roles: backend, skills, permission mode and workspace kind.', icon: Users (lucide), searchEntries: getAlicornMembersSearchEntries(), group: 'workflows' }`.
- `getAlicornMembersSearchEntries()` built with `createLocalizedCatalog` like `orchestration-search.ts`: one entry `{ title: 'Members', description: …, keywords: ['member', 'role', 'backend', 'reviewer'] }`.
- `renderAlicornMembersSettingsSection(context: SettingsRenderContext)` — copy the shape of `renderOrchestrationSettingsSection` in `settings-capability-section-renderers.tsx` (same imports; `SettingsSection id="alicorn-members" …`; mount `<AlicornMembersPane />` when `view.isSectionMounted('alicorn-members')`).
- `AlicornMembersPane` (props: none; reads `window.api.alicorn`): loads members on mount; shows a list (name · role · backend · permission mode) with Edit/Delete; "New member" opens an inline form: `Input` name, `Select` role / backend / workspace kind / permission mode (options from the shared enums), `Textarea` system rules, `Input` skills (comma-separated → `skills[]`); Save → create/update; errors → `toast.error(message)` (`sonner`, as `CliSection` does); `control_plane_unconfigured` → a `SettingsRow` explaining that `ALICORN_CONTROL_API_URL` and `ALICORN_LOCAL_API_TOKEN` must be set (link to `docs/alicorn/LOCAL-DEV.md`). Use `SettingsSubsectionHeader`, `SettingsRow` from `./SettingsFormControls` and primitives from `../ui/{button,input,select,textarea}`.
- [ ] **Step 1: Failing render test** — mock `window.api.alicorn.listMembers` to resolve two members; render; expect both names; click "New member", fill name, choose `reviewer`/`codex`, submit → `createMember` called with `{ name, role: 'reviewer', backend: 'codex', workspaceKind: 'worktree', permissionMode: 'accept_edits', systemRules: '', skills: [] }`. Follow `AccountsPane.test.tsx` for the render/mocking harness.
- [ ] **Step 2: Run** `pnpm test src/renderer/src/components/settings/AlicornMembersPane.test.tsx` → FAIL. **Step 3: Implement** with plain English strings. **Step 4: Localize:** `node config/scripts/localize-renderer-strings.mjs && pnpm run sync:localization-catalog && pnpm run verify:localization-extraction && pnpm run verify:localization-coverage`. **Step 5:** test → PASS; `pnpm tc:web`; `pnpm run check:code-quality:changed`. **Step 6: Manual check:** with the local stack running, Settings → Workflows → Members lists the three seeded members; create a fourth; reload; it persists (it is in Postgres, not local). **Step 7: Commit** `feat(alicorn): Members settings pane`.

---

### Task 5 (C1): SQLite schema v31 — outbox, task strategy, dispatch members

**Files:**
- Create: `src/main/runtime/orchestration/db/schema/create-alicorn-tables-sql.ts`, `src/main/runtime/orchestration/db/schema/migrate-v31-alicorn.ts`
- Create: `src/main/runtime/orchestration/db/alicorn/{ledger-outbox-methods,task-strategy-methods,dispatch-member-methods}.ts`
- Modify: `src/main/runtime/orchestration/db/contract-constants.ts` (`SCHEMA_VERSION = 31`), `schema/create-tables.ts` (append `createAlicornTablesSql()`), `schema/migrate.ts` (call `applySchemaMigrationV31.call(this, current)` after the v13–v30 call), `db/orchestration-db-methods.ts` + `db/attach-orchestration-db-methods.ts` (attach the three method sets the same way `attachWorkerReportSettlement` is attached)
- Test: `src/main/runtime/orchestration/db/alicorn/ledger-outbox-methods.test.ts`, `task-strategy-methods.test.ts`, `dispatch-member-methods.test.ts` (each on `new OrchestrationDb(':memory:')`)

**Interfaces:**
```sql
CREATE TABLE IF NOT EXISTS ledger_outbox (
  id           TEXT PRIMARY KEY,                 -- generateId('lob')
  kind         TEXT NOT NULL CHECK (kind IN ('step_outcome', 'context_capture', 'spend_attribution', 'step_verification')),
  dedupe_key   TEXT NOT NULL UNIQUE,             -- `${kind}:${dispatchId}` (+ `:${name}` for verifications)
  payload      TEXT NOT NULL,                    -- JSON
  attempts     INTEGER NOT NULL DEFAULT 0,
  not_before   TEXT,                             -- ISO; null = due now
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_outbox_due ON ledger_outbox(sent_at, not_before);
CREATE TABLE IF NOT EXISTS alicorn_task_strategy (
  task_id                TEXT PRIMARY KEY,
  strategy               TEXT NOT NULL CHECK (strategy IN ('single', 'orchestrated')),
  source                 TEXT NOT NULL CHECK (source IN ('default', 'user', 'escalation')),
  escalation_offered_at  TEXT,
  escalation_accepted_at TEXT,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS alicorn_dispatch_members (
  dispatch_id            TEXT PRIMARY KEY,
  member_id              TEXT NOT NULL,
  member_role            TEXT NOT NULL,
  backend                TEXT NOT NULL,          -- MemberBackend
  review_backend_bypass  INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
```
Methods (all `this: OrchestrationDb`, attached to the prototype):
- `enqueueLedgerOutbox(item: { kind; dedupeKey: string; payload: unknown; notBefore?: string }): { id: string; duplicate: boolean }` — `INSERT OR IGNORE`; `duplicate` when `changes === 0`.
- `listDueLedgerOutbox(limit = 25, nowIso = new Date().toISOString()): LedgerOutboxRow[]` — `WHERE sent_at IS NULL AND (not_before IS NULL OR not_before <= ?) ORDER BY created_at LIMIT ?`.
- `markLedgerOutboxSent(id)`, `markLedgerOutboxFailed(id, error: string, retryAt: string)` (`attempts + 1`, `not_before = retryAt`, `last_error`).
- `getTaskExecutionStrategy(taskId): { strategy: 'single' | 'orchestrated'; source; escalationOfferedAt: string | null; escalationAcceptedAt: string | null }` — returns `{ strategy: 'single', source: 'default', … null }` when no row.
- `setTaskExecutionStrategy(taskId, strategy, source: 'user' | 'escalation')` — upsert; `source: 'escalation'` also stamps `escalation_accepted_at`.
- `markEscalationOffered(taskId): boolean` — upsert row keeping strategy `single`; returns `false` if already offered (so the watcher offers once).
- `setDispatchMember(row: { dispatchId; memberId; memberRole; backend; reviewBackendBypass: boolean })`, `getDispatchMember(dispatchId): DispatchMemberRow | undefined`.
- Migration v31: `if (current < 31) this.db.exec(createAlicornTablesSql())` (pure `CREATE TABLE IF NOT EXISTS`, safe for both fresh and existing DBs).

- [ ] **Step 1: Failing tests** — enqueue twice with the same `dedupeKey` → second `duplicate: true` and one row; `listDueLedgerOutbox` skips `not_before` in the future; `markLedgerOutboxFailed` increments attempts and hides the row until `retryAt`; strategy default is `single/default`; `markEscalationOffered` true then false; `setDispatchMember`/`getDispatchMember` round-trip with `reviewBackendBypass` as boolean.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (mirror `worker-dispatch-outcome.ts` for the attach pattern). **Step 4:** run the three test files + `pnpm test src/main/runtime/orchestration/db` (existing schema/migration tests must still pass with version 31). **Step 5: Commit** `feat(alicorn): orchestration DB v31 — ledger outbox, task strategy, dispatch members`.

---

### Task 6 (C2): Enqueue a step outcome inside the settlement transaction

**Files:**
- Modify: `src/main/runtime/orchestration/db/dispatch-context/worker-report-settlement.ts` (in `settleWorkerReportInTransaction`, immediately before `this.db.exec('RELEASE settle_worker_report')` on the success path)
- Modify: `src/main/runtime/orchestration/lifecycle-reconciliation.ts` (add `phase` to the `result` JSON)
- Test: `src/main/runtime/orchestration/db/dispatch-context/worker-report-settlement-outbox.test.ts`

- [ ] **Step 1: Failing test** — using the existing orchestration test harness pattern (`new OrchestrationDb(':memory:')`, create run/task/dispatch as `orchestration-tasks-dispatch.test.ts` does), settle a `succeeded` report → `SELECT * FROM ledger_outbox` has exactly one row with `kind 'step_outcome'`, `dedupe_key 'step_outcome:<dispatchId>'`, payload `{ taskId, dispatchId, outcome: 'succeeded', result }`; settling the same report again (duplicate path) adds no row; a rejected settlement adds no row.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement:**
```ts
  // Why: the ledger's exactly-once guarantee starts here — the outbox row commits with the settlement or not at all.
  this.enqueueLedgerOutbox({
    kind: 'step_outcome',
    dedupeKey: `step_outcome:${params.dispatchId}`,
    payload: { taskId: params.taskId, dispatchId: params.dispatchId, outcome: params.outcome, result: params.result }
  })
  this.db.exec('RELEASE settle_worker_report')
  return { action: 'settled', outcome: params.outcome, duplicate: false }
```
and in `lifecycle-reconciliation.ts` extend the `result` object with `phase: typeof payload.phase === 'string' ? payload.phase : null`.
- [ ] **Step 4:** `pnpm test src/main/runtime/orchestration` → PASS (existing settlement tests unchanged). **Step 5: Commit** `feat(alicorn): enqueue settled worker reports to the ledger outbox`.

---

### Task 7 (C3): Outbox drainer → Ledger API

**Files:**
- Create: `src/main/alicorn/step-outcome-builder.ts`, `src/main/alicorn/ledger-outbox-drainer.ts`
- Create: `src/main/alicorn/ledger/ledger-writer.ts` — `createLedgerWriter(): LedgerWriter` over B1's `alicornFetch('ledger', …)`; no dependency on B2.
- Create: `src/shared/alicorn/ledger.ts` (if not created in B2: `StepOutcomeInput`, `StepVerificationInput`, `ContextCaptureInput`, `SpendPatch` — field names identical to the contract package; `ProvenanceReport`/`RunCost` are B2's)
- Modify: `src/main/startup/main-process-runtime-service.ts` — after `state.runtime = runtime`, start the drainer: `state.ledgerOutboxDrainer = startLedgerOutboxDrainer({ getDb: () => runtime.getOrchestrationDb(), runtime, writer: createLedgerWriter() /* C3's own instance, over B1's alicornFetch; never B2's client */, claudeUsage: state.claudeUsage, codexUsage: state.codexUsage, intervalMs: 5_000 })`; stop it in the quit path next to other timers (search `watcherShutdownPromise` usage in `src/main/startup/` for the shutdown phase and add `state.ledgerOutboxDrainer?.stop()`); add `ledgerOutboxDrainer: null as LedgerOutboxDrainer | null` to `main-process-state.ts`.
- Test: `src/main/alicorn/step-outcome-builder.test.ts`, `src/main/alicorn/ledger-outbox-drainer.test.ts`, `src/main/alicorn/ledger/ledger-writer.test.ts`

**Interfaces:**
- `type LedgerWriter = { postStepOutcome(input: StepOutcomeInput): Promise<{ id: string; duplicate: boolean }>; patchStepOutcomeSpend(id: string, patch: SpendPatch): Promise<void>; postStepVerification(input: StepVerificationInput): Promise<{ id: string; duplicate: boolean }>; postContextCapture(input: ContextCaptureInput): Promise<{ id: string; duplicate: boolean }> }` (`ledger-writer.ts`). *Decision (R9):* C3 owns its writer; it depends on B1 only — not on B2's `ControlPlaneClient` or D2's `MemberDirectory`.
- `buildStepOutcomeInput(input: { db: OrchestrationDb; payload: { taskId; dispatchId; outcome; result: string }; worktree: { id: string; path: string; branch: string; repoId: string; projectId?: string } | null }): StepOutcomeInput`:
  - `runId` = `db.getTask(taskId)?.run_id`; `stageKey` = `parsedResult.phase ?? 'build'`; `filesModified` = `parsedResult.filesModified ?? []`; `reportSummary` = first 4000 chars of `parsedResult.body`;
  - member = `db.getDispatchMember(dispatchId)`; `memberId`, `backend` = member?.backend ?? `backendFromWorkerStartOptions(db.getWorkerDispatch(dispatchId)?.start_options)` (parse JSON `{ agent?: TuiAgent }` → `tuiAgentToAgentKind(agent)` → map `claude-code→'claude'`, `codex→'codex'`, `grok→'grok'`, `openclaude→'openclaude'`, else `'other'`); `reviewBackendBypass` = member?.reviewBackendBypass ?? false;
  - `executionStrategy`/`escalationOffered`/`escalationAccepted` from `db.getTaskExecutionStrategy(taskId)`;
  - `worktreeId/branch/repoId/projectId` from `worktree` (projectId falls back to repoId); `clientTs` = ISO of `dispatch_contexts.completed_at` (SQLite `datetime('now')` is UTC without a zone: append `'Z'` after replacing the space with `'T'`).
- `startLedgerOutboxDrainer(deps): LedgerOutboxDrainer` with `{ stop(): void; drainOnce(): Promise<{ sent: number; failed: number }> }`; `deps.writer: LedgerWriter | null`. `drainOnce`: for each `listDueLedgerOutbox(25)` row by `kind`:
  - `step_outcome` → resolve worktree via `runtime.showManagedWorktree(\`id:${worker.worktree_id}\`)` when `db.getWorkerDispatch(dispatchId)?.worktree_id` exists (catch → `null`); `writer.postStepOutcome(build(...))` → on success `markLedgerOutboxSent`, then **enqueue** `{ kind: 'spend_attribution', dedupeKey: 'spend_attribution:<dispatchId>', payload: { dispatchId, taskId, outcomeId: result.id, backend, worktreeId, startedAt: dispatched_at, completedAt: completed_at }, notBefore: now + 60s }` (transcripts flush late) and, if the outcome succeeded and a worktree exists, `{ kind: 'step_verification', dedupeKey: 'step_verification:<dispatchId>:diff_coverage', payload: { dispatchId, taskId, runId, worktreeId, worktreePath, branch, projectId } }` (Task D5 consumes it).
  - `context_capture` → `writer.postContextCapture(payload)`.
  - `spend_attribution` → Task C5's `attributeDispatchUsage` → `writer.patchStepOutcomeSpend(outcomeId, patch)`.
  - `step_verification` → Task D5's `runDiffCoverageCheck` → `writer.postStepVerification(...)` (skipped when no required check for the project).
  - Failure: `markLedgerOutboxFailed(id, message, retryAt)` with backoff `min(5 min, 5s * 2^attempts)`; `ControlPlaneUnavailableError('control_plane_unconfigured')` (or a null writer) is not an error — leave the rows untouched (no attempts bump) and stop this pass; log once per 5 minutes.
  - Never delete rows; never drop on error.
- [ ] **Step 1: Failing tests** — builder: given an in-memory DB with a task (run `run_1`, phase in result `review`), a dispatch member `{ memberId 'm1', role 'reviewer', backend 'codex', reviewBackendBypass true }`, strategy `orchestrated` → `{ runId: 'run_1', stageKey: 'review', backend: 'codex', memberId: 'm1', reviewBackendBypass: true, executionStrategy: 'orchestrated', … }`; no member and `start_options {"agent":"claude"}` → backend `'claude'`; unknown → `'other'`. Writer: fake `alicornFetch` — each of the four methods posts to the right `ledger` path and maps the response. Drainer: fake writer; one `step_outcome` row → `postStepOutcome` called once, row marked sent, a `spend_attribution` row with `not_before` ≈ +60 s and a `step_verification` row now exist; writer throws `ControlPlaneRequestError(500)` → row `attempts 1`, `not_before` set, not sent; `ControlPlaneUnavailableError` → row untouched.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** tests PASS; `pnpm tc:node`. **Step 5: Manual:** with the stack up and `cloud/dev/compose/desktop.env.example` sourced, `orca orchestration task-create --spec "hello"` → dispatch a worker (`orca orchestration worker-start --task <id> --agent claude`) → in the worker run `orca orchestration send --type worker_done --outcome succeeded --subject done` → within 10 s `curl -H "authorization: Bearer $ALICORN_LOCAL_API_TOKEN" -H "x-alicorn-org: local" 'http://127.0.0.1:8082/v1/ledger/provenance?repoId=<repo>&branch=<branch>'` shows one outcome. **Step 6: Commit** `feat(alicorn): drain the ledger outbox to the Ledger API with backoff`.

---

### Task 8 (C4): Context capture at dispatch

**Files:**
- Modify: `src/main/runtime/rpc/methods/orchestration-dispatch-methods.ts` (real dispatch path, after `const preamble = buildDispatchPreamble({...})` with `dispatchId: ctx.id`) and `src/main/runtime/rpc/methods/orchestration-workers.ts` (after the `buildDispatchPreamble` call at the `dispatch_input` stage)
- Create: `src/main/alicorn/context-capture-enqueue.ts`
- Test: `src/main/alicorn/context-capture-enqueue.test.ts`

**Interfaces:**
- `enqueueContextCapture(db: OrchestrationDb, input: { runId: string; taskId: string; dispatchId: string; prompt: string; contextSlice: Record<string, unknown> }): void` — if `Buffer.byteLength(prompt) > 64 * 1024`: write the prompt to `join(app.getPath('userData'), 'alicorn', 'context-captures', `${dispatchId}.md`)` (inject `writePromptFile` for tests) and enqueue `{ promptPath }`; else `{ prompt }`. `dedupeKey: 'context_capture:<dispatchId>'`. Never throws (log and continue — a capture must not block a dispatch).
- Context slice fields: `{ taskSpec, coordinatorHandle, workerHandle, depth, canDispatchSubWorkers, cliCommand, devMode, memberId?, memberRole?, backend?, model?, effort?, agent? }` — everything the worker was given, and nothing it produced.
- [ ] **Step 1: Failing test** — small prompt → outbox row with `payload.prompt`; 70 KB prompt → `writePromptFile` called, `payload.promptPath` set, no `prompt`; called twice → one row.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire both call sites** (`dispatch`: `runId: run.id`, member from `db.getDispatchMember(ctx.id)`; `workerStart`: `params.agent`, `params.model`, `params.effort`). **Step 4:** tests PASS; `pnpm test src/main/runtime/rpc/methods/orchestration-tasks-dispatch.test.ts src/main/runtime/rpc/methods/orchestration-workers-new-worktree.test.ts` still PASS. **Step 5: Commit** `feat(alicorn): capture the exact dispatched prompt and context slice per run`.

---

### Task 9 (C5): Cost attribution → ledger spend

**Files:**
- Create: `src/main/alicorn/run-usage-attribution.ts`
- Test: `src/main/alicorn/run-usage-attribution.test.ts`

**Interfaces:**
- `attributeDispatchUsage(input: { backend: string; worktreeId: string | null; startedAt: string | null; completedAt: string | null; claudeUsage: Pick<ClaudeUsageStore, 'getAutomationRunUsage'> | null; codexUsage: Pick<CodexUsageStore, 'getAutomationRunUsage'> | null }): Promise<SpendPatch>` — `backend 'claude'` → `claudeUsage.getAutomationRunUsage({ worktreeId, terminalSessionId: null, startedAt: parseSqliteUtc(startedAt), completedAt: parseSqliteUtc(completedAt) })`; `'codex'` → codexUsage; else `{ spendCents: null, usage: { status: 'unavailable', unavailableReason: 'provider_unsupported' } }`. Known usage → `spendCents = Math.round(estimatedCostUsd * 100)`, `usage = { status, provider, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, providerSessionId, attribution }`. Unavailable → `spendCents: null`, `usage: { status: 'unavailable', unavailableReason, unavailableMessage }`.
- `parseSqliteUtc(value: string | null): number | null` — `'2026-09-06 01:02:03'` → `Date.UTC(...)`.
- [ ] **Step 1: Failing test** — fake stores returning a known `AutomationRunUsage` (`estimatedCostUsd 0.8234`) → `spendCents 82`; ambiguous → null spend with reason; backend `grok` → `provider_unsupported`; `parseSqliteUtc('2026-09-06 01:02:03')` equals `Date.UTC(2026, 8, 6, 1, 2, 3)`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement; call it from the drainer's `spend_attribution` branch (Task C3).** **Step 4:** PASS. **Step 5: Commit** `feat(alicorn): attribute Claude and Codex usage to settled dispatches`.

---

### Task 10 (D1): `execution_strategy` on tasks (RPC + CLI)

**Files:**
- Modify: `src/main/runtime/rpc/methods/orchestration-schemas.ts` — `TaskCreateParams` and `TaskUpdateParams` gain `executionStrategy: z.enum(['single', 'orchestrated']).optional()`
- Modify: the `orchestration.taskCreate` / `orchestration.taskUpdate` handlers (find them with `grep -n "'orchestration.taskCreate'\|'orchestration.taskUpdate'" src/main/runtime/rpc/methods/*.ts`) — after the task row is created/updated: `if (params.executionStrategy) db.setTaskExecutionStrategy(task.id, params.executionStrategy, 'user')`; include `executionStrategy: db.getTaskExecutionStrategy(task.id).strategy` in the returned task object (additive field).
- Modify: `src/cli/specs/orchestration.ts` usage lines for `task-create` / `task-update` (`[--execution-strategy <single|orchestrated>]`) and the CLI handlers that build the RPC params (grep `'orchestration task-create'` in `src/cli/handlers/orchestration/`) — pass `executionStrategy: getOptionalStringFlag(flags, 'execution-strategy')`.
- Test: extend `src/main/runtime/rpc/methods/orchestration-tasks-dispatch.test.ts` (or a sibling `orchestration-task-execution-strategy.test.ts` using `orchestration-rpc-test-harness.ts`)

- [ ] **Step 1: Failing test** — `taskCreate` without the flag → returned task has `executionStrategy: 'single'` and no `alicorn_task_strategy` row; with `orchestrated` → row `{ strategy: 'orchestrated', source: 'user' }`; `taskUpdate { executionStrategy: 'single' }` flips it back; an invalid value is rejected by zod (`400`/`invalid_argument` per the harness's convention).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** `pnpm test src/main/runtime/rpc/methods src/cli/specs` → PASS; `pnpm tc:node && pnpm tc:cli`. Also `pnpm run verify:bundled-skill-guides` if the spec text is mirrored into the bundled guide (the lint chain runs it; follow its fix instructions if it fails). **Step 5: Commit** `feat(alicorn): execution_strategy on orchestration tasks`.

---

### Task 11 (D2): `--member` on `worker-start` and `dispatch`, member directory cache

**Files:**
- Create: `src/main/alicorn/member-directory.ts`, `src/main/alicorn/worker-member-launch.ts`
- Modify: `src/main/runtime/rpc/methods/orchestration-worker-start-schema.ts` (`member: OptionalString`, `allowSameBackendReview: z.boolean().optional()`), `orchestration-schemas.ts` `DispatchParams` (same two fields), `orchestration-workers.ts` (resolve member before any worktree/terminal effect; force `agent` from the member's backend; after `createStartingWorkerDispatch` returns, `db.setDispatchMember(...)`), `orchestration-dispatch-methods.ts` (after `ctx` exists, `db.setDispatchMember(...)`), `src/cli/specs/orchestration-worker-specs.ts` + `src/cli/specs/orchestration.ts` usage lines (`[--member <id>] [--allow-same-backend-review]`), `src/cli/handlers/orchestration/worker-launch-handler.ts` + `dispatch-handlers.ts` (pass the flags)
- Test: `src/main/alicorn/member-directory.test.ts`, `src/main/alicorn/worker-member-launch.test.ts`

**Interfaces:**
- `createMemberDirectory(client: ControlPlaneClient, opts?: { ttlMs?: number; now?: () => number }): MemberDirectory` with `getMember(id): Promise<Member | null>`, `getOrgPolicy(): Promise<OrgPolicy>`, `getRequiredChecks(projectId): Promise<RequiredCheck[]>`; each cached 60 s; a failed refresh returns the stale value if any, else rethrows. `getOrgPolicy` on total failure returns `{ enforceDistinctReviewerBackend: true }` (fail closed) and logs.
- `memberBackendToTuiAgent(backend: MemberBackend): TuiAgent` — `claude→'claude'`, `codex→'codex'`, `grok→'grok'`, `openclaude→'openclaude'`.
- `resolveWorkerMemberLaunch(input: { db: OrchestrationDb; directory: MemberDirectory; taskId: string; memberId?: string; requestedAgent?: string; allowSameBackendReview?: boolean }): Promise<{ agent: string | undefined; dispatchMember: { memberId; memberRole; backend; reviewBackendBypass: boolean } | null }>`:
  - no `memberId` → `{ agent: requestedAgent, dispatchMember: null }`;
  - unknown member → throw `new OrchestrationError('unknown_member', \`Member ${memberId} not found in this organisation.\`)`;
  - `requestedAgent` set and ≠ member backend → throw `OrchestrationError('member_agent_conflict', …)`;
  - member.role === `'reviewer'` → Task D3's `evaluateReviewBackend` decides (throws `reviewer_backend_conflict` or sets `reviewBackendBypass`);
  - returns `agent = memberBackendToTuiAgent(member.backend)`.
- The directory instance lives on the runtime: add `runtime.setAlicornMemberDirectory(directory)` / `runtime.getAlicornMemberDirectory(): MemberDirectory | null` (a tiny mixin file `src/main/runtime/orca-runtime-alicorn-services.ts`, wired in `configureRuntimeServices` in `main-process-runtime-service.ts`). Handlers that receive `--member` when the directory is null throw `OrchestrationError('control_plane_unconfigured', 'Members require the Alicorn control plane; set ALICORN_CONTROL_API_URL and ALICORN_LOCAL_API_TOKEN.')`.
- [ ] **Step 1: Failing tests** — directory caches for 60 s and serves stale on error; policy fetch failure → enforce true; `resolveWorkerMemberLaunch` cases above (fake directory, in-memory DB).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire.** **Step 4:** `pnpm test src/main/alicorn src/main/runtime/rpc/methods` PASS; `pnpm tc:node && pnpm tc:cli`. **Step 5: Commit** `feat(alicorn): launch workers and dispatches as Members`.

---

### Task 12 (D3): Reviewer ≠ author backend policy

**Files:**
- Create: `src/main/alicorn/review-backend-policy.ts`, `src/main/alicorn/author-backends.ts`
- Test: `src/main/alicorn/review-backend-policy.test.ts`, `src/main/alicorn/author-backends.test.ts`

**Interfaces:**
- `evaluateReviewBackend(input: { reviewerBackend: MemberBackend; authorBackends: ReadonlySet<string>; enforce: boolean; bypassRequested: boolean }): { allowed: true; bypassed: boolean } | { allowed: false; reason: string }` — conflict = `authorBackends.has(reviewerBackend)`; no conflict → `{ allowed: true, bypassed: false }`; conflict + `!enforce` → `{ allowed: true, bypassed: true }` (policy off is still recorded as a bypass — the run report must say the reviewer ran on the author's backend); conflict + enforce + bypassRequested → `{ allowed: true, bypassed: true }`; conflict + enforce → `{ allowed: false, reason: 'Reviewer backend "codex" matches the author backend. Pick a member on a different backend, or pass --allow-same-backend-review to record a bypass.' }`.
- `getAuthorBackendsForTask(db: OrchestrationDb, taskId: string): Set<string>` — `deps = JSON.parse(task.deps)`; for each dep: `SELECT dc.id FROM dispatch_contexts dc WHERE dc.task_id = ? AND dc.status = 'completed'`; per dispatch: `db.getDispatchMember(id)?.backend` else `backendFromWorkerStartOptions(db.getWorkerDispatch(id)?.start_options)` (reuse from C3's builder; move it to `src/main/alicorn/backend-from-start-options.ts` so both import it). Ignore `'other'`.
- In `resolveWorkerMemberLaunch` (D2): `const verdict = evaluateReviewBackend({ reviewerBackend: member.backend, authorBackends: getAuthorBackendsForTask(db, taskId), enforce: (await directory.getOrgPolicy()).enforceDistinctReviewerBackend, bypassRequested: allowSameBackendReview === true })`; `!verdict.allowed` → `throw new OrchestrationError('reviewer_backend_conflict', verdict.reason)`.
- [ ] **Step 1: Failing tests** — the four `evaluateReviewBackend` cases; `getAuthorBackendsForTask` with a dep task whose completed dispatch has member backend `claude` and another with start options `{"agent":"codex"}` → `Set{'claude','codex'}`; pending dispatches ignored.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Manual:** create two members (Developer/claude, Reviewer/claude); dispatch the build task as Developer, `worker_done`; `worker-start --member <Reviewer>` on a task that depends on it → rejected with the reason; `--allow-same-backend-review` → starts; after `worker_done` the ledger row has `review_backend_bypass: true`. **Step 6: Commit** `feat(alicorn): enforce reviewer ≠ author backend, record bypasses`.

---

### Task 13 (D4): Context-ceiling watcher and the escalation offer

**Files:**
- Create: `src/main/alicorn/transcript-context-tail.ts`, `src/main/alicorn/context-ceiling-watcher.ts`, `src/shared/alicorn/context-ceiling.ts` (`export const ALICORN_CONTEXT_CEILING_TOKENS = 300_000`; `export type EscalationOffer = { taskId: string; dispatchId: string; paneKey: string | null; contextTokens: number }`)
- Modify: `src/main/claude-usage/store.ts` — add `getRecentSessionTranscriptsForWorktree(worktreeId: string, sinceMs: number): Array<{ sessionId: string; path: string; lastTimestamp: string }>` (reads `this.state.processedFiles`, matching `sessions[].locationBreakdown[].worktreeId === worktreeId && Date.parse(lastTimestamp) >= sinceMs`; no rescan)
- Create: `src/renderer/src/components/alicorn/EscalationOfferToaster.tsx` — mounted once in the app shell (next to where `sonner`'s `<Toaster>` is mounted; grep `<Toaster` in `src/renderer/src`); subscribes via `window.api.alicorn.onEscalationOffer`; `toast(message, { action: { label: 'Switch to orchestrated', onClick: () => window.api.alicorn.setTaskExecutionStrategy({ taskId, strategy: 'orchestrated', source: 'escalation' }) }, duration: 30_000 })`.
- Modify: `main-process-runtime-service.ts` — start the watcher next to the drainer; `main-process-state.ts` field.
- Test: `src/main/alicorn/transcript-context-tail.test.ts`, `src/main/alicorn/context-ceiling-watcher.test.ts`

**Interfaces:**
- `contextTokensFromTranscriptTail(text: string): number | null` — scan lines from the end; for the last line where `parseClaudeUsageRecord(line)` (from `src/main/claude-usage/transcript-record-parser.ts`) returns a turn → `inputTokens + cacheReadTokens + cacheWriteTokens`; `null` if none.
- `readTranscriptTail(path: string, maxBytes = 256 * 1024): Promise<string>` — `fs.open` + `read` from `max(0, size - maxBytes)`.
- `startContextCeilingWatcher(deps: { getDb; claudeUsage: ClaudeUsageStore | null; ceilingTokens?: number; intervalMs?: number; publish: (offer: EscalationOffer) => void; readTail?: typeof readTranscriptTail; now?: () => number }): { stop(); tickOnce(): Promise<EscalationOffer[]> }` — each tick: `SELECT dc.id AS dispatch_id, dc.task_id, wd.worktree_id, wd.start_options FROM dispatch_contexts dc JOIN worker_dispatches wd ON wd.dispatch_id = dc.id WHERE dc.status = 'dispatched'`; keep rows whose backend is `claude` and whose task strategy is `single` with `escalation_offered_at IS NULL`; for each: sessions active in the last 3 minutes on that worktree → tail → tokens; if `>= ceiling` and `db.markEscalationOffered(taskId)` returns true → publish `{ taskId, dispatchId, paneKey: null, contextTokens }`. Publishing uses `mainProcessState.mainWindow?.webContents.send(ALICORN_EVENTS.escalationOffer, offer)` (skip when no window).
- [ ] **Step 1: Failing tests** — tail parser: fixture of three JSONL lines where the last assistant record has `usage { input_tokens: 250000, cache_read_input_tokens: 60000, cache_creation_input_tokens: 1000 }` → `311000`; trailing partial line ignored; no usage → null. Watcher: in-memory DB with a dispatched claude worker on worktree `wt1`, fake store returning one transcript, fake `readTail` returning the fixture → one offer published and `escalation_offered_at` set; second tick → nothing; strategy already `orchestrated` → nothing; below ceiling → nothing.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire + toaster (localize strings).** **Step 4:** PASS; `pnpm tc:node && pnpm tc:web`. **Step 5: Commit** `feat(alicorn): offer orchestrated execution when a single-agent task crosses the context ceiling`.

---

### Task 14 (D5): Diff coverage as a required check

**Files:**
- Create: `src/main/alicorn/diff-coverage/lcov-parser.ts`, `unified-diff-added-lines.ts`, `diff-coverage.ts`, `diff-coverage-check.ts`, `required-checks-fetch.ts`
- Test: one `.test.ts` beside each (fixtures inline)

**Interfaces (pure first):**
- `parseLcov(text: string): Map<string, Set<number>>` — file path (`SF:`) → covered line numbers (`DA:<line>,<hits>` with hits > 0); reset per `end_of_record`.
- `addedLinesFromUnifiedDiff(text: string): Map<string, Set<number>>` — from `git diff -U0`: `+++ b/<path>` names the file; each hunk header `@@ -a,b +c,d @@` sets the new-file cursor to `c`; every `+` line (not `+++`) records the cursor then increments; context lines (none with `-U0`) and `-` lines do not advance the new cursor.
- `computeDiffCoverage(added: Map<string, Set<number>>, covered: Map<string, Set<number>>, opts?: { normalize?: (p: string) => string }): { total: number; covered: number; ratio: number; perFile: Array<{ path: string; total: number; covered: number }> }` — lcov paths may be absolute or repo-relative; normalise both sides with `normalize` (default: strip a leading `./`, and if the lcov path is absolute, take the suffix relative to `worktreePath`). `ratio = total === 0 ? 1 : covered / total` (an empty diff is trivially covered).
- `runDiffCoverageCheck(input: { worktreePath: string; baseRef: string; check: DiffCoverageCheck; runProcess?: typeof runProcess; gitExec?: (argv: string[]) => Promise<{ stdout: string }>; readFile?: typeof fs.readFile }): Promise<StepVerificationInput['status'] extends infer S ? { status: S; detail: Record<string, unknown> } : never>`:
  1. if `check.command`: `runProcess({ program: process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh', args: process.platform === 'win32' ? ['/d', '/s', '/c', check.command] : ['-lc', check.command], cwd: worktreePath, timeoutMs: check.timeoutMs, maxOutputBytes: 1_000_000 })` — non-zero exit → `{ status: 'error', detail: { stage: 'command', code, stderrTail } }` (Windows: build the argv through `runProcess`, never `shell: true`; see AGENTS.md → *Windows child processes*).
  2. `git diff -U0 --no-color ${baseRef}...HEAD` via `gitExec` (default `gitExecFileAsync(argv, { cwd: worktreePath, admissionTier: 'interactive' })`); git failure → `error`.
  3. read `join(worktreePath, check.lcovPath)`; missing → `{ status: 'error', detail: { stage: 'lcov', message: 'lcov file not found' } }`.
  4. `ratio >= check.threshold` → `passed` else `failed`; `detail = { threshold, ratio, total, covered, perFile (top 20 worst), baseRef }`.
- `fetchRequiredChecks(projectId: string): Promise<RequiredCheck[]>` (`required-checks-fetch.ts`) — `const res = await alicornFetch('control', \`/v1/projects/${projectId}/required-checks\`); return (await res.json()).checks`. *Decision (R9):* depends on B1's `alicornFetch` only, not on D2's `MemberDirectory` — the drainer (Huy's) never imports the members-directory code (Nghia's).
- Drainer branch (`step_verification` rows from C3): `checks = await fetchRequiredChecks(projectId)`; no `diff_coverage` → `markLedgerOutboxSent` (nothing to record); folder workspace / no `.git` → post `{ status: 'skipped', detail: { reason: 'not_a_git_worktree' } }`; SSH-hosted worktree (`worktree.hostId` not local) → `skipped` `{ reason: 'remote_worktree' }`; else `baseRef = (await getBaseRefDefault(worktreePath)) ?? 'origin/main'` (from `src/main/git/repo-default-base-ref.ts`) → run → `writer.postStepVerification({ runId, taskId, dispatchId, kind: 'diff_coverage', name: \`Diff coverage ≥ ${Math.round(threshold * 100)}%\`, required: true, status, detail })` (Task C3's `LedgerWriter`).
- [ ] **Step 1: Failing tests** — lcov fixture with two files, `DA` hits 0 and 3; diff fixture with two hunks and a deletion-only hunk; `computeDiffCoverage` → `{ total: 5, covered: 3, ratio: 0.6 }`; absolute lcov paths normalise against `worktreePath`; `runDiffCoverageCheck` with fakes: command fails → `error`; lcov missing → `error`; ratio 0.6 vs threshold 0.5 → `passed`, vs 0.8 → `failed`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** PASS; `pnpm tc:node`. **Step 5: Manual:** set `PUT /v1/projects/<repoId>/required-checks` to `[{ kind: 'diff_coverage', threshold: 0.8, command: 'pnpm test --coverage --coverage.reporter=lcov <path>' }]` for this repo via `curl` with the shared token; run a worker that changes a tested file; after `worker_done` the provenance endpoint shows a `diff_coverage` verification with a ratio. **Step 6: Commit** `feat(alicorn): diff coverage as a project required check`.

---

### Task 15 (D6): PR body from provenance

**Files:**
- Create: `src/main/alicorn/provenance-markdown.ts`
- Modify: `src/main/ipc/hosted-review.ts` — in the `hostedReview:create` handler, before building `input`, compose the body
- Test: `src/main/alicorn/provenance-markdown.test.ts`

**Interfaces:**
- `renderProvenanceMarkdown(report: ProvenanceReport, opts: { policyEnforced: boolean }): string` — returns `''` when `report.outcomes.length === 0`; otherwise:
```markdown
<!-- alicorn:provenance:start -->
## Provenance

Recorded by Alicorn from the run ledger. 2 steps · 2 dispatches · est. spend $0.82.

| Step | Member | Backend | Strategy | Outcome | Files | Spend |
|---|---|---|---|---|---|---|
| build | Developer | claude | single | succeeded | 14 | $0.61 |
| review | Reviewer | codex | single | succeeded | 0 | $0.21 |

**Checks**
- ✅ Diff coverage ≥ 80% — 86% of 152 added lines covered (required)

**Reviewer backend rule** — enforced; the reviewer ran on a different backend from the author.
<!-- or: **Reviewer backend rule** — ⚠️ bypassed: the reviewer ran on the author's backend (recorded on the run). -->

**Execution** — single agent throughout. <!-- or: escalation to orchestrated offered at build (accepted / declined) -->

**Worker reports**
- build: <first line of reportSummary, ≤ 200 chars>
- review: …

**Context captured** for 2 dispatches (exact prompts are in the ledger).
<!-- alicorn:provenance:end -->
```
  Member names come from `report.outcomes[].memberId` resolved through the directory (`getMember`) when available, else the backend name; spend formatting `$${(cents/100).toFixed(2)}`, `—` when null; ratio from `detail.ratio`.
- `composeReviewBody(input: { body: string | undefined; useTemplate: boolean | undefined; readTemplate: () => Promise<string>; provenance: string }): Promise<{ body: string; useTemplate: boolean | undefined }>` — strips any existing `<!-- alicorn:provenance:start -->…<!-- alicorn:provenance:end -->` block; if `provenance === ''` returns the input unchanged; base = `body?.trim() ? body : (useTemplate ? await readTemplate() : '')`; returns `{ body: \`${base.trimEnd()}\n\n${provenance}\n\`, useTemplate: false }` (the template is already inlined, so the provider must not re-apply it).
- Handler wiring (`hosted-review.ts`): `const branch = args.head ?? (await getCurrentBranch(worktreePath, executionHostId, executionOptions))` (import `getCurrentBranch` from `../source-control/hosted-review-creation-git-state`); `const report = await client.getProvenance(repo.id, branch).catch(() => null)` (any error → no section; PR creation must never fail because the ledger is down); `const policy = await directory.getOrgPolicy()`; `const composed = await composeReviewBody({ body: args.body, useTemplate: args.useTemplate, readTemplate: () => readPullRequestTemplate(worktreePath, hostedReviewSshConnectionId(executionHostId)), provenance: report ? renderProvenanceMarkdown(report, { policyEnforced: policy.enforceDistinctReviewerBackend }) : '' })`; then `body: composed.body`, `useTemplate: composed.useTemplate` in `input`. Applies to every provider because it happens before `createHostedReview`.
- [ ] **Step 1: Failing tests** — render fixture → contains the table row for `review`, the ✅ check line, the bypass warning when `reviewBackend.bypassed`; empty outcomes → `''`; `composeReviewBody` inlines the template when body is empty and `useTemplate`, strips a stale block, and leaves a body untouched when provenance is empty.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire.** **Step 4:** PASS; `pnpm test src/main/ipc` (existing hosted-review tests still pass — the handler must behave identically when `client`/`directory` are absent or fail). **Step 5: Manual:** create a PR from a worktree that had a ledger'd run → GitHub PR body ends with the Provenance section. **Step 6: Commit** `feat(alicorn): post the run's provenance into the pull request body`.

---

### Task 16 (D7): Per-run cost surfaced in the sidebar

**Files:**
- Create: `src/shared/alicorn/run-cost.ts` (`export type RunCostByDispatch = Record<string, { costUsd: number | null; status: 'known' | 'unavailable' | 'pending' }>`; `export function formatRunCostUsd(costUsd: number | null): string` → `'—'` for null, `'<$0.01'` under a cent, else `'$0.82'`; `export const ALICORN_RUN_COST_EVENT = 'alicorn:runCost'` — D7's own event constant, not `ALICORN_EVENTS`)
- Create: `src/main/alicorn/run-cost-publisher.ts`
- Modify: `src/main/claude-usage/store.ts` and `src/main/codex-usage/store.ts` — add `getLastScanCompletedAt(): number | null` (returns `this.state.scanState.lastScanCompletedAt`)
- Modify: `src/renderer/src/components/sidebar/worktree-card-compact-agent-row.tsx` — render a cost chip after the model chip when `agent.entry.orchestration?.dispatchId` has a known cost
- Create: `src/preload/api/alicorn-run-cost-bridge.ts`, `src/preload/api/alicorn-run-cost-api.ts` — D7's own preload bridge, separate from B3's `alicorn-bridge.ts`/`alicorn-api.ts`; exposes `window.api.alicornRunCost.onChanged`
- Modify: `src/preload/index.ts` (add `alicornRunCost: alicornRunCostApi` to the `api` object, additive one-liner), `src/preload/api-types.ts` (`alicornRunCost: AlicornRunCostApi`, additive one-liner)
- Create: `src/renderer/src/hooks/useAlicornRunCost.ts` — subscribes once (`window.api.alicornRunCost.onChanged`) into a small zustand slice or `useSyncExternalStore` store `alicornRunCostStore` in `src/renderer/src/store/alicorn-run-cost-store.ts`; exposes `useDispatchCost(dispatchId | undefined)`
- Modify: `main-process-runtime-service.ts` / `main-process-state.ts` — start/stop like the drainer
- Test: `src/shared/alicorn/run-cost.test.ts`, `src/main/alicorn/run-cost-publisher.test.ts`

**Interfaces:**
- `src/preload/api/alicorn-run-cost-api.ts`: `export type AlicornRunCostApi = { onChanged: (cb: (payload: RunCostByDispatch) => void) => () => void }`; bridge (`alicorn-run-cost-bridge.ts`): `ipcRenderer.on(ALICORN_RUN_COST_EVENT, listener)` returning an unsubscribe, exactly like B3's `onEscalationOffer`. D7 owns this bridge end to end — B3's `window.api.alicorn` carries `onEscalationOffer` only.
- `startRunCostPublisher(deps: { getDb; claudeUsage; codexUsage; publish: (payload: RunCostByDispatch) => void; intervalMs?: number; now?: () => number }): { stop(); tickOnce(): Promise<RunCostByDispatch> }` — each tick: dispatches `dispatched` or completed in the last 24 h joined with `worker_dispatches` (`worktree_id`, `start_options`) and `alicorn_dispatch_members` (backend); for each with a worktree and backend `claude`/`codex`: `completedAt = min(now, store.getLastScanCompletedAt() ?? now)` (so `getAutomationRunUsage` never forces a rescan on our cadence — the stores' own scanner sets freshness); `startedAt = dispatched_at`; `status 'known'` → `costUsd = estimatedCostUsd`; `unavailable` → `{ costUsd: null, status: 'unavailable' }`; other backends → `unavailable`. Publish only when the payload changed (JSON compare) via `mainProcessState.mainWindow?.webContents.send(ALICORN_RUN_COST_EVENT, payload)` (`run-cost.ts`'s own constant, not `ALICORN_EVENTS`).
- Renderer chip: `<span className="… text-xs text-muted-foreground tabular-nums" title="Estimated spend for this dispatch (API-equivalent)">{formatRunCostUsd(cost.costUsd)}</span>` — same classes as the existing model chip at `worktree-card-compact-agent-row.tsx:246-255`; shown only when `cost?.status === 'known'`.
- [ ] **Step 1: Failing tests** — `formatRunCostUsd(null) === '—'`, `(0.004) === '<$0.01'`, `(0.8234) === '$0.82'`; publisher: one claude dispatch → fake store called with `completedAt` = lastScanCompletedAt, payload `{ ctx_1: { costUsd: 0.82, status: 'known' } }`; unchanged second tick publishes nothing; grok dispatch → `unavailable`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire + localize the tooltip.** **Step 4:** PASS; `pnpm tc:node && pnpm tc:web`; `pnpm run check:code-quality:changed`. **Step 5: Manual:** run a Claude worker; within a minute the agent row shows `$0.xx` and it grows while the worker works. **Step 6: Commit** `feat(alicorn): show estimated per-dispatch spend in the agent row`.

---

### Task 17 (E1): Docs, env example, smoke checklist

**Files:**
- Modify: `docs/alicorn/LOCAL-DEV.md` (from B1) — add the end-to-end smoke checklist below; `docs/alicorn/INFRASTRUCTURE.md` §3 — reference `cloud/dev/compose/alicorn-local.yml` as the `local` environment; `cloud/README.md` — link LOCAL-DEV.

- [ ] **Step 1: Smoke checklist (manual, record results in the PR description):**
  1. `cd cloud && pnpm alicorn:up && pnpm alicorn:seed` → both `/healthz` ok; seed prints org id.
  2. `source cloud/dev/compose/desktop.env.example && pnpm dev`.
  3. Settings → Workflows → Members → three seeded members; create *Reviewer B* (codex); quit and relaunch — it is still there (Postgres, not local).
  4. CLI: `task-create` → `worker-start --member <Developer>` → worker sends `worker_done --phase build` → provenance endpoint shows the outcome with `backend claude`, `execution_strategy single`, a context capture, and (after ~1 min) `spend_cents`.
  5. `worker-start --member <Reviewer on claude>` on a dependent task → rejected `reviewer_backend_conflict`; with `--allow-same-backend-review` → allowed; ledger row `review_backend_bypass true`.
  6. Push the branch, create a PR from the sidebar → PR body has the Provenance section with the bypass warning and the diff-coverage line (after configuring the project's required check).
  7. Sidebar agent row shows `$0.xx` while a Claude worker runs.
  8. Kill the desktop between `worker_done` and the drainer's next tick (stop the Ledger API first so the send fails, then quit the app, restart both) → the outcome is delivered once; `SELECT count(*) FROM step_outcomes WHERE dispatch_id = …` is 1.
- [ ] **Step 2: Commit** `docs(alicorn): local development and tier-1 smoke checklist`.

---

## Self-review

- **Spec coverage against PROJECT-BRIEF §08.** (1) `execution_strategy` + escalation offer → D1 + D4 (context-ceiling signal; multi-repo signal explicitly deferred to v2.0). (2) PR body from provenance → D6 (all forge providers; template preserved). (3) Context capture → C4 (exact injected preamble + context slice; overflow to file + path). (4) Diff coverage required check → D5 (project-anchored, admin-authored, `skipped` for folder/remote workspaces). (5) Reviewer ≠ author backend → D2 + D3 (enforced by default, `--allow-same-backend-review`, bypass recorded in the ledger and rendered in the PR body — §11.4 verbatim). (6) Per-run cost → C5 (ledger spend) + D7 (live chip). Substrate: B1 (local control-plane env), B2–B4 (Members), C1–C3 (ledger writes, exactly-once). Identity (Keycloak) deferred by user decision; `readAlicornBearer` is the single swap point.
- **Placeholder scan.** Every task names files, interfaces, test cases and commands. Two places lean on "find the call site with grep" (D1 handlers, D4 `<Toaster>` mount) because the exact line moves with upstream merges; the code to add is fully specified.
- **Type consistency.** `StepOutcomeInput` field names are identical in `src/shared/alicorn/ledger.ts` and the cloud contract (`runId, taskId, dispatchId, projectId, repoId, worktreeId, branch, memberId, backend, stageKey, executionStrategy, outcome, filesModified, reportSummary, reviewBackendBypass, escalationOffered, escalationAccepted, clientTs`); the drainer posts exactly that, through C3's own `LedgerWriter` (`postStepOutcome`, `patchStepOutcomeSpend`, `postStepVerification`, `postContextCapture`) — B2's `ControlPlaneClient` no longer carries these. `getDispatchMember` returns `{ dispatchId, memberId, memberRole, backend, reviewBackendBypass: boolean }` and is read by C3, D3 and D7. `db.getTaskExecutionStrategy(taskId).strategy` is the only source of `executionStrategy` (C3, D1, D4). IPC channel names come from `ALICORN_IPC`/`ALICORN_EVENTS`, plus `ALICORN_RUN_COST_EVENT` (`run-cost.ts`) for the cost push.
- **Order of execution (R9: the two chains are decoupled).** B1 first (both owners depend on it), C1 first on Huy's side; then each owner's chain independently — Nghia: B2 → B3 → B4 → D2 → D3, D1 → D4, C4 → D6; Huy: C2 → C3 → C5 → D5 → D7 → E1.
