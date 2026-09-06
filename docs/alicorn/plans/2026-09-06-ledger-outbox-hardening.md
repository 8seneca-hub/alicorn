# Ledger Outbox Hardening Implementation Plan (LG1, LG2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Caveat:** the SQLite schema version is allocated at execution time — v33 is reserved by the ledger-completion plan; use the next free number (`SCHEMA_VERSION` in `src/main/runtime/orchestration/db/contract-constants.ts`). Anchors below are from `main` at `55a421db4`; re-verify when picking a task up.

**Goal:** A ledger outbox row that can never succeed stops retrying, stays visible with its last error and can be requeued by hand — never deleted; and the required-check runner leaves the drain loop so a ten-minute project test command no longer stalls ledger delivery, and runs inside WSL for WSL-hosted worktrees.

**Architecture:** The drainer (`src/main/alicorn/ledger-outbox-drainer.ts`) keeps its shape: list due rows, process, mark sent / failed. This plan adds a third terminal state, **dead** (`dead_at`, `dead_reason` on `ledger_outbox`), decided by a pure failure-classification function: a non-retryable 4xx from the Ledger API or `MAX_OUTBOX_ATTEMPTS` exhausted → dead; 401/403 → the pass stops and logs (auth is misconfigured, no row is at fault); everything else keeps the existing bounded backoff. `step_verification` rows move to their own worker with its own cadence, concurrency of one and a row timeout, sharing the drainer's row-outcome handling through one extracted module. Dead rows surface through an RPC and the CLI (`orca ledger outbox --dead`, `outbox-requeue`); the desktop never deletes a row.

**Tech Stack:** orchestration SQLite (`db/alicorn/ledger-outbox-methods.ts`, versioned migrations in `db/schema/`), `ledger-outbox-drainer.ts`, `control-plane-http.ts` errors (`ControlPlaneRequestError.status/.code`), `runProcess` / `runWslProcess` (`src/main/wsl/wsl-runner.ts`), CLI specs/handlers (`src/cli`), RPC methods, vitest.

**Spec:** `CLAUDE.md` → *Control plane: Postgres from day one* ("It is a queue, never a data store: nothing reads it back except the drainer" — this plan adds a read-only operator view, not a second consumer of the data), *The ledger is append-only and exactly-once*; `docs/alicorn/ARCHITECTURE.md` §6 *Rules that keep the ledger honest*; `AGENTS.md` (WSL commands via `buildWslExecArgs`; SSH boundary); the desktop tier-1 final review (recorded in `plans/2026-09-06-tier-1-desktop.md` § *Amendments*, D-R6). Plane: LG1 (ALC-96), LG2 (ALC-97), module *Ledger*, owner Huy.

## Global Constraints

- **Never delete an outbox row.** Dead is a flag (`dead_at IS NOT NULL`); requeue clears it. The exactly-once guarantee stays with the server's unique key; the client key `dedupe_key` is untouched.
- **A 401/403 from the Ledger API is a configuration problem, not a row problem**: stop the pass, log through the existing 5-minute throttle, leave every row untouched (same behaviour as `ControlPlaneUnavailableError`).
- **Non-retryable client errors**: HTTP 400, 404, 405, 409 (except the duplicate-200 path, which is success), 413, 415, 422 → dead immediately with `dead_reason = '<status> <code>'`. 408, 425, 429 and all 5xx/network errors → retry with the existing backoff (`min(5 min, 5 s · 2^attempts)`).
- **`MAX_OUTBOX_ATTEMPTS = 50`** (≈ 4 h at the 5-minute cap after the exponential phase) → dead with `dead_reason = 'max_attempts'`.
- **Dying is logged every time** (not throttled): `[ledger-outbox] row dead` with `{ id, kind, attempts, reason }`. Requeue logs once.
- **Verification rows run one at a time** in their own worker, on their own timer (10 s), with a row ceiling of 20 minutes; the drainer never processes `step_verification` rows once the worker exists.
- **WSL**: a `check.command` for a worktree whose git options carry `wslDistro` runs inside that distro through `runWslProcess` with argv built by `buildWslExecArgs` — never `cmd.exe /c` with free text, never `shell: true` (AGENTS.md → *WSL commands*, *Windows EDR signal*).
- Additive changes only; `runProcess`/`gitExecFileAsync` only (a ratchet fails the build on `child_process`); no `helpers`/`utils` names; concise "why" comments; Alicorn-branded names; no AI attribution in commits.

## Decisions made in this plan

1. **Dead is a column pair, not a status enum.** `dead_at TEXT`, `dead_reason TEXT` on `ledger_outbox`; `listDueLedgerOutbox` adds `AND dead_at IS NULL`. Rebuilding the table (SQLite cannot alter a CHECK) is unnecessary — `ADD COLUMN` suffices.
2. **Failure classification is a pure function** (`classifyOutboxFailure(error, attemptsAfterThisFailure)`) shared by the drainer and the verification worker; tests enumerate every status class.
3. **The operator view is the CLI**, via RPC: `ledger.outboxList`, `ledger.outboxRequeue`. No renderer surface in this plan (the Foreman run view, FM4, can show a dead count later).
4. **The verification worker consumes by kind.** `listDueLedgerOutbox` gains an optional `kinds` filter; the drainer is started with `excludeKinds: ['step_verification']` and the worker with `kinds: ['step_verification']`. Both call the same `settleOutboxRow(db, row, outcome)` helper extracted into `outbox-row-processing.ts`.
5. **Row ceiling via `AbortSignal`**: the worker passes `signal: AbortSignal.timeout(rowTimeoutMs)` to the runner, which forwards it to `runProcess` (`ProcessSpec.signal`) and to `gitExecFileAsync` (`options.signal`); a timeout is a *retryable* failure (message `verification_row_timeout`), so the cheap kinds are never blocked and a slow project gets another chance.
6. **WSL lcov path**: the lcov file is read at `join(worktree.path, check.lcovPath)` on the host, exactly as today — Orca stores WSL worktree paths in a host-visible form and passes the same path as `cwd` to `gitExecFileAsync`. If the file is missing the existing `error { stage: 'lcov', message: 'lcov file not found' }` result stands.

## File structure

```
src/main/runtime/orchestration/db/schema/migrate-vNN-outbox-dead-letter.ts (+test)   ALTER TABLE ledger_outbox ADD COLUMN dead_at / dead_reason; fresh-DB columns in create-alicorn-tables-sql.ts
src/main/runtime/orchestration/db/alicorn/ledger-outbox-methods.ts                    listDueLedgerOutbox(kinds filter, excludes dead), markLedgerOutboxDead, listDeadLedgerOutbox, countDeadLedgerOutbox, requeueLedgerOutbox
src/main/runtime/orchestration/db/alicorn/alicorn-rows.ts                              LedgerOutboxRow + dead_at, dead_reason
src/main/alicorn/outbox-failure-policy.ts (+test)                                       MAX_OUTBOX_ATTEMPTS, classifyOutboxFailure()
src/main/alicorn/outbox-row-processing.ts (+test)                                       settleOutboxRow(): sent | retry | dead | stop_pass handling + logging (extracted from the drainer)
src/main/alicorn/ledger-outbox-drainer.ts                                               uses the two modules; excludeKinds; no verification branch when excluded
src/main/alicorn/verification-worker.ts (+test)                                         startVerificationWorker(): kinds ['step_verification'], concurrency 1, row timeout
src/main/alicorn/diff-coverage/diff-coverage-check.ts                                   signal forwarding; WSL command routing via injected runWsl
src/main/runtime/rpc/methods/alicorn-ledger.ts                                          ledger.outboxList / ledger.outboxRequeue (file created by the ledger-completion plan Task 8 if it exists; else create)
src/cli/specs/ledger.ts, src/cli/handlers/ledger/outbox-handlers.ts (+tests)           orca ledger outbox [--dead] [--limit N] [--json]; orca ledger outbox-requeue --id <id>
src/main/startup/main-process-runtime-service.ts, main-process-state.ts, main-process-quit.ts   start/stop the worker (additive one-liners)
docs/alicorn/ARCHITECTURE.md §6, CLAUDE.md working rule
```

---

### Task 1 (LG1a): dead-letter columns and outbox methods

**Files:**
- Create: `src/main/runtime/orchestration/db/schema/migrate-vNN-outbox-dead-letter.ts`, `…/migrate-vNN-outbox-dead-letter.test.ts` (NN = next free version)
- Modify: `src/main/runtime/orchestration/db/schema/create-alicorn-tables-sql.ts` (fresh-DB columns), `db/schema/migrate.ts` (register), `db/contract-constants.ts` (`SCHEMA_VERSION` + history line), `db/alicorn/alicorn-rows.ts`, `db/alicorn/ledger-outbox-methods.ts`
- Test: `db/alicorn/ledger-outbox-methods.test.ts` (extend)

**Interfaces (produces):**
```ts
// alicorn-rows.ts
export type LedgerOutboxRow = { …existing…; dead_at: string | null; dead_reason: string | null }
// ledger-outbox-methods.ts
export function listDueLedgerOutbox(this: OrchestrationDb, limit = 25, nowIso = new Date().toISOString(), filter?: { kinds?: LedgerOutboxKind[]; excludeKinds?: LedgerOutboxKind[] }): LedgerOutboxRow[]
// WHERE sent_at IS NULL AND dead_at IS NULL AND (not_before IS NULL OR not_before <= ?) [AND kind IN (...)] [AND kind NOT IN (...)] ORDER BY created_at LIMIT ?
export function markLedgerOutboxDead(this: OrchestrationDb, id: string, reason: string): void
// UPDATE ledger_outbox SET dead_at = datetime('now'), dead_reason = ?, attempts = attempts + 1 WHERE id = ? AND sent_at IS NULL
export function listDeadLedgerOutbox(this: OrchestrationDb, limit = 50): LedgerOutboxRow[]        // WHERE dead_at IS NOT NULL ORDER BY dead_at DESC LIMIT ?
export function countDeadLedgerOutbox(this: OrchestrationDb): number
export function requeueLedgerOutbox(this: OrchestrationDb, id: string): boolean                    // UPDATE … SET dead_at = NULL, dead_reason = NULL, attempts = 0, not_before = NULL, last_error = NULL WHERE id = ? AND dead_at IS NOT NULL; returns changes === 1
```
Migration (idempotent, follows `migrate-v32-run-cost-index.ts`):
```ts
export function applySchemaMigrationVNN(this: OrchestrationDb, current: number): void {
  if (current < NN) {
    // Why: SQLite has no ADD COLUMN IF NOT EXISTS; check pragma table_info first so a re-run on a half-migrated DB is safe.
    const cols = new Set((this.db.prepare('PRAGMA table_info(ledger_outbox)').all() as { name: string }[]).map((c) => c.name))
    if (!cols.has('dead_at')) this.db.exec('ALTER TABLE ledger_outbox ADD COLUMN dead_at TEXT')
    if (!cols.has('dead_reason')) this.db.exec('ALTER TABLE ledger_outbox ADD COLUMN dead_reason TEXT')
  }
}
```
- [ ] **Step 1: Failing tests** — migration test: open `:memory:` at version NN−1 (drop the two columns is impossible in old SQLite; instead create the table from the pre-NN SQL literal copied into the test), run the migration → `PRAGMA table_info` has both columns and `user_version === NN`; fresh DB has them. Methods test: due list excludes a dead row; `kinds`/`excludeKinds` filters; `markLedgerOutboxDead` then `requeueLedgerOutbox` → row due again with `attempts 0`; `countDeadLedgerOutbox` counts.
- [ ] **Step 2: Run** `env PATH=/Users/huy/.nvm/versions/node/v24.20.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin corepack pnpm test src/main/runtime/orchestration/db` → FAIL. **Step 3: Implement.** **Step 4:** PASS; `… corepack pnpm tc:node`.
- [ ] **Step 5: Commit** `feat(alicorn): ledger outbox dead-letter columns and requeue`.

---

### Task 2 (LG1b): failure policy and row settlement, applied in the drainer

**Files:**
- Create: `src/main/alicorn/outbox-failure-policy.ts` (+ test), `src/main/alicorn/outbox-row-processing.ts` (+ test)
- Modify: `src/main/alicorn/ledger-outbox-drainer.ts` (`drainOnce` catch block at ~:256-275 uses `settleOutboxRow`; `deps.excludeKinds?: LedgerOutboxKind[]` passed to `listDueLedgerOutbox`), `ledger-outbox-drainer.test.ts`

**Interfaces (produces):**
```ts
// outbox-failure-policy.ts
export const MAX_OUTBOX_ATTEMPTS = 50
export type OutboxFailureDecision = { action: 'retry' } | { action: 'dead'; reason: string } | { action: 'stop_pass'; reason: 'control_plane_unconfigured' | 'control_plane_unauthorized' }
export function classifyOutboxFailure(error: unknown, attemptsAfterThisFailure: number): OutboxFailureDecision
// ControlPlaneUnavailableError → stop_pass 'control_plane_unconfigured'
// ControlPlaneRequestError status 401|403 → stop_pass 'control_plane_unauthorized'
// ControlPlaneRequestError status in {400,404,405,409,413,415,422} → dead `${status} ${code}`
// attemptsAfterThisFailure >= MAX_OUTBOX_ATTEMPTS → dead 'max_attempts'
// otherwise → retry
// outbox-row-processing.ts
export type RowOutcome = { kind: 'sent' } | { kind: 'failed'; error: unknown }
export function settleOutboxRow(db: OrchestrationDb, row: LedgerOutboxRow, outcome: RowOutcome, deps: { now: () => number; warn: (message: string, detail: Record<string, unknown>) => void; throttledWarn: (message: string, detail: Record<string, unknown>) => void }): 'sent' | 'retry' | 'dead' | 'stop_pass'
// sent → markLedgerOutboxSent; failed → classify(error, row.attempts + 1): retry → markLedgerOutboxFailed(id, message, retryAt = now + backoff(row.attempts)) + throttledWarn('row failed') (first failure always warns — keep the existing rule); dead → markLedgerOutboxDead(id, reason) + warn('[ledger-outbox] row dead', { id, kind, attempts, reason }); stop_pass → no DB write, throttledWarn(reason) and return 'stop_pass' (caller breaks)
```
The drainer's `handleStepOutcome` transaction, `logUnavailableOnce`, `logRowFailure` and `backoffMs` move into or are called from `outbox-row-processing.ts` so the worker (Task 4) reuses them; the drainer's behaviour for `sent`/`retry`/unconfigured is unchanged (existing tests must stay green).
- [ ] **Step 1: Failing tests** — policy: one case per status class above, plus `attempts 49 → retry`, `attempts 50 → dead max_attempts`; drainer: a `ControlPlaneRequestError(404, 'not_found')` → row has `dead_at`, `dead_reason '404 not_found'`, is not listed as due, `warn` called once with `row dead`; a 500 → retry as before; a 403 → pass stops, rows untouched, throttled warn mentions `unauthorized`; `excludeKinds: ['step_verification']` → verification rows are never fetched.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** `… corepack pnpm test src/main/alicorn` PASS; `tc:node`.
- [ ] **Step 5: Commit** `feat(alicorn): outbox failure policy — dead-letter non-retryable rows, stop on unauthorized`.

---

### Task 3 (LG1c): operator view — RPC and CLI

**Files:**
- Modify or create: `src/main/runtime/rpc/methods/alicorn-ledger.ts` (created by the ledger-completion plan Task 8 with `ledger.report`; if absent, create it and register it where `ORCHESTRATION_METHODS`-style method lists are assembled — find the registration by grepping for an existing method name such as `orchestration.gateCreate`), `src/cli/specs/ledger.ts` (same rule), create `src/cli/handlers/ledger/outbox-handlers.ts`
- Test: `alicorn-ledger.test.ts` (RPC harness, in-memory db), `outbox-handlers.test.ts` (mocked client), spec test

**Interfaces:**
```ts
// RPC
'ledger.outboxList': params { dead?: boolean; limit?: number } → { rows: Array<{ id; kind; dedupeKey; attempts; lastError: string | null; notBefore: string | null; deadAt: string | null; deadReason: string | null; createdAt: string }>; deadCount: number }
// dead: true → listDeadLedgerOutbox(limit); otherwise listDueLedgerOutbox(limit, now) (pending); deadCount always from countDeadLedgerOutbox()
'ledger.outboxRequeue': params { id: string } → { requeued: boolean }
// CLI specs (binary name follows the rebrand plan; today `orca`)
{ path: ['ledger', 'outbox'], summary: 'Show pending or dead ledger outbox rows', usage: 'orca ledger outbox [--dead] [--limit <n>] [--json]', allowedFlags: [...GLOBAL_FLAGS, 'dead', 'limit'] }
{ path: ['ledger', 'outbox-requeue'], summary: 'Requeue a dead ledger outbox row', usage: 'orca ledger outbox-requeue --id <id> [--json]', allowedFlags: [...GLOBAL_FLAGS, 'id'] }
// text output: header `dead: <n>`; then a table id | kind | attempts | last_error (60 chars) | dead_reason
```
- [ ] **Step 1: Failing tests** — RPC harness: seed one due and one dead row → `outboxList` default returns the due row and `deadCount 1`; `--dead` returns the dead row; `outboxRequeue` on the dead id → `requeued true`, row due again; unknown id → `requeued false`. CLI handler: `--dead --json` prints the RPC result; text mode prints `dead: 1` and one table line.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** PASS; `tc:node`, `tc:cli` if the repo has it (`pnpm tc:cli`).
- [ ] **Step 5: Commit** `feat(alicorn): orca ledger outbox — list pending or dead rows, requeue by id`.

---

### Task 4 (LG2a): verification worker

**Files:**
- Create: `src/main/alicorn/verification-worker.ts` (+ test)
- Modify: `src/main/alicorn/ledger-outbox-drainer.ts` (drop the `step_verification` branch when `excludeKinds` contains it — keep the code path only for the `kinds` filter default), `src/main/alicorn/diff-coverage/verification-runner.ts` + `diff-coverage-check.ts` (accept and forward `signal?: AbortSignal` to `runProcess` and `gitExecFileAsync`), `src/main/startup/main-process-runtime-service.ts` (start the worker after the drainer with the same `writer` and `verificationRunner`; drainer gets `excludeKinds: ['step_verification']`), `main-process-state.ts` (`verificationWorker`), `main-process-quit.ts` (`state.verificationWorker?.stop()`)

**Interfaces:**
```ts
export const VERIFICATION_ROW_TIMEOUT_MS = 20 * 60_000
export type VerificationWorkerDeps = { getDb: () => OrchestrationDb | null; writer: LedgerWriter | null; verificationRunner: VerificationRunner | null; intervalMs?: number /* 10_000 */; rowTimeoutMs?: number; now?: () => number }
export function startVerificationWorker(deps: VerificationWorkerDeps): { stop(): void; tickOnce(): Promise<{ processed: number; result: 'sent' | 'retry' | 'dead' | 'stop_pass' | 'idle' }> }
// tick: if running → skip; rows = db.listDueLedgerOutbox(1, nowIso, { kinds: ['step_verification'] }); none → idle; payload = JSON.parse(row.payload); const signal = AbortSignal.timeout(rowTimeoutMs); await verificationRunner(payload, writer, { signal }) → settleOutboxRow(db, row, { kind: 'sent' }); throw → settleOutboxRow(db, row, { kind: 'failed', error }) (a timeout surfaces as an AbortError → 'retry' with message 'verification_row_timeout')
// VerificationRunner gains a third optional parameter: (payload, writer, options?: { signal?: AbortSignal })
```
- [ ] **Step 1: Failing tests** — worker: one due verification row + fake runner → runner called once, row sent; runner throws 404 → row dead; runner never resolves within `rowTimeoutMs` (fake timers) → row `attempts 1`, `last_error` contains `verification_row_timeout`, not dead; two rows → processed one per tick; drainer with `excludeKinds` leaves verification rows untouched (extend `ledger-outbox-drainer.test.ts`). Runner: `signal` forwarded to the fake `runProcess`/`gitExec` calls.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire.** **Step 4:** `… corepack pnpm test src/main/alicorn` PASS; `tc:node`.
- [ ] **Step 5: Commit** `feat(alicorn): required checks run in their own worker with a row timeout`.

---

### Task 5 (LG2b): WSL routing for the coverage command

**Files:**
- Modify: `src/main/alicorn/diff-coverage/diff-coverage-check.ts` (`input.runWsl?: typeof runWslProcess`; when `input.gitOptions?.wslDistro` is set, run `check.command` via `runWslProcess` instead of `runProcess`), `verification-runner.ts` (pass `runWsl: runWslProcess` from the default deps), test `diff-coverage-check.test.ts`

**Interfaces:**
```ts
import { runWslProcess, type WslSpec, type WslResult } from '../../wsl/wsl-runner'
import { buildWslExecArgs } from '../../../shared/wsl-login-shell-command'
// in runDiffCoverageCheck, command step:
const distro = input.gitOptions?.wslDistro
const result = distro
  ? await toProcessResult(await (input.runWsl ?? runWslProcess)(wslSpecForCheck(distro, input.worktreePath, check.command, check.timeoutMs, signal)))
  : await (input.runProcess ?? runProcess)({ program, args, cwd: input.worktreePath, timeoutMs: check.timeoutMs, maxOutputBytes: 1_000_000, signal })
// wslSpecForCheck builds the argv with buildWslExecArgs({ distro, command: ['/bin/sh', '-lc', command], cwd }) — read src/main/wsl/wsl-runner.ts:27-95 for the exact WslSpec fields (distro, argv/command, cwd, timeoutMs) and src/shared/wsl-login-shell-command.ts:15 for buildWslExecArgs's signature; never pass free text to `--` (wsl.exe expands $name there); use `--exec`.
// toProcessResult maps WslResult { code, stdout, stderr, timedOut } onto the shape the existing error/success branches read.
```
- [ ] **Step 1: Failing test** — `gitOptions: { wslDistro: 'Ubuntu' }` + fake `runWsl` → `runProcess` not called, `runWsl` called with a spec whose distro is `Ubuntu` and whose argv contains `--exec`; a non-zero WSL exit → `error { stage: 'command' }` exactly as the host path.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** PASS; `tc:node`. **Step 5: Commit** `feat(alicorn): run the coverage command inside WSL for WSL-hosted worktrees`.

---

### Task 6: docs

- `docs/alicorn/ARCHITECTURE.md` §6 *Rules that keep the ledger honest*: add "**Dead rows are kept.** A row the Ledger API rejects with a non-retryable error, or that fails 50 times, is marked `dead_at`/`dead_reason`, listed by `orca ledger outbox --dead` and requeued by hand; it is never deleted."
- `CLAUDE.md` → *Working in this repo*: "Anything written to the Ledger goes through the outbox … A dead outbox row is an operator signal (`orca ledger outbox --dead`), not garbage."
- `docs/alicorn/LOCAL-DEV.md` smoke checklist: step 8 gains "then `orca ledger outbox` shows no dead rows".
- [ ] Commit `docs(alicorn): outbox dead-letter rows and the verification worker`.

---

## Self-review

- **Spec coverage.** LG1 → Tasks 1, 2, 3, 6; LG2 → Tasks 4, 5, 6. The final review's exact observations (never-succeeding rows retry forever silently; head-of-line blocking; `check.command` not routed through WSL) each map to a task.
- **Placeholder scan.** Every task has interfaces, SQL/argv, test cases and a commit message; the one open lookup (exact `WslSpec` field names) points at the file and lines that define it.
- **Type consistency.** `classifyOutboxFailure`/`OutboxFailureDecision` (Task 2) are used by Task 4 through `settleOutboxRow`; `listDueLedgerOutbox(limit, nowIso, { kinds, excludeKinds })` (Task 1) is called by Tasks 2 and 4; `VerificationRunner`'s new third parameter (Task 4) is what Task 5's runner forwards as `signal`.
- **Order.** 1 → 2 → 3 → 4 → 5 → 6. Needs the desktop tier-1 work on `main` (present); Task 3 shares files with the ledger-completion plan's Task 8 — whichever lands second rebases (both Huy).
