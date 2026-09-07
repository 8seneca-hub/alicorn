# Ledger Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three findings the ledger reviews filed rather than fixed — the outbox grows without bound, a WSL-hosted check cannot be cancelled, and a stored context capture cannot be read back.

**Architecture:** Three independent changes in code that already ships. Retention is a second timer beside the drainer that deletes only *sent* rows. Cancellation threads the `AbortSignal` that already exists on the host branch through the WSL branch. The capture read route is a new `GET` on the Ledger API over a table that is already written.

**Tech Stack:** Electron main (TypeScript, better-sqlite3), Hono 4 + `pg` 8 + zod 3 in `cloud/`, vitest 4, Node 24.

**Spec:** Plane ALC-99 (LG3), ALC-101 (LG4), ALC-102 (LG4); `docs/alicorn/ARCHITECTURE.md`; `CLAUDE.md` (*Control plane: Postgres from day one*); `docs/reference/wsl-command-execution.md`.

## Global Constraints

- **`ledger_outbox` is a queue, never a data store.** Nothing reads it back except the drainer and the operator listing. Retention may delete only rows already delivered.
- **A dead row is an operator signal, not garbage.** `dead_at` rows are kept until a human requeues them. Retention must never touch them, regardless of age.
- **The ledger is append-only and exactly-once.** The server's unique key is the real exactly-once boundary; the client dedupe key only has to outlive the retry window. Any retention horizon must be argued against that, in the commit message.
- **WSL argv is built by `buildWslExecArgs` (always `--exec`)** and anything whose stdout is parsed is fenced with `buildWslCapturedLoginShellCommand`. Do not hand-roll argv, and never add `-lc` to a WSL invocation. See `docs/reference/wsl-command-execution.md`.
- **Never import `child_process` directly.** Start processes through `runProcess`/`spawnProcess` in `src/shared/child-process/`. A ratchet test fails on any new direct import.
- **`wsl-runner.ts` is shared platform code** used by the account, skill, hook and CLI-installer subsystems. Every change to it is additive and must not alter existing callers.
- **Cloud suites test against a real Postgres** when `ALICORN_TEST_POSTGRES_URL` is set, and skip without it. They never fake it.
- **`tenant_id` on every product row with forced RLS**, and wire changes are additive or capability-negotiated.
- Toolchain: desktop `env PATH=/Users/huy/.nvm/versions/node/v24.20.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin corepack pnpm …`; cloud the same PATH with `pnpm --dir cloud …` and `ALICORN_TEST_POSTGRES_URL=postgres://test:test@127.0.0.1:5433/alicorn_test`.
- No Claude or AI attribution in commit messages.

---

### Task 1 (LG3): Outbox retention — delete delivered rows, count what is left

**Files:**
- Create: `src/main/alicorn/outbox-retention.ts`, `src/main/alicorn/outbox-retention.test.ts`
- Modify: `src/main/runtime/orchestration/db/alicorn/ledger-outbox-methods.ts` (+ `deleteSentLedgerOutboxBefore`, `countLedgerOutbox`), `src/main/startup/main-process-runtime-service.ts` (start the timer), `src/main/startup/main-process-state.ts` (hold the handle)

**Interfaces:**
- Produces:
  ```ts
  // ledger-outbox-methods.ts, attached like the existing methods
  deleteSentLedgerOutboxBefore(this: OrchestrationDb, cutoffIso: string): number  // rows removed
  countLedgerOutbox(this: OrchestrationDb): { pending: number; sent: number; dead: number }
  // outbox-retention.ts
  export const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
  export const OUTBOX_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000
  export function startOutboxRetention(deps: {
    getDb: () => OrchestrationDb | null
    intervalMs?: number
    now?: () => number
  }): { stop: () => void; sweepOnce: () => { deleted: number; counts: { pending: number; sent: number; dead: number } } }
  ```

- [ ] **Step 1: Write the failing tests** in `outbox-retention.test.ts`, against a real in-memory orchestration database built the way the existing outbox tests build one (copy the harness from `src/main/runtime/orchestration/db/schema/migrate-v37-outbox-dead-letter.test.ts`):
  - a row with `sent_at` 31 days old is deleted
  - a row with `sent_at` 29 days old is kept
  - **a dead row 400 days old is kept** — this is the one that matters; assert on `dead_at IS NOT NULL` surviving
  - a pending row (never sent) 400 days old is kept
  - `sweepOnce` returns the deleted count and the three counts
  - the timer is not required for the assertions: call `sweepOnce` directly

- [ ] **Step 2: Run them and watch them fail.** `… corepack pnpm test src/main/alicorn/outbox-retention.test.ts > /tmp/r1.log 2>&1`, then read the log. Expected: module not found.

- [ ] **Step 3: Add the two database methods.** In `ledger-outbox-methods.ts`, beside `requeueAllDeadLedgerOutbox`, following its exact style and registering both in `LedgerOutboxMethods` and `attachLedgerOutboxMethods`:

```ts
export function deleteSentLedgerOutboxBefore(this: OrchestrationDb, cutoffIso: string): number {
  // Why sent_at IS NOT NULL and dead_at IS NULL: a dead row is an operator signal kept until requeued (LG1).
  return this.db
    .prepare(`DELETE FROM ledger_outbox WHERE sent_at IS NOT NULL AND dead_at IS NULL AND sent_at < ?`)
    .run(cutoffIso).changes
}

export function countLedgerOutbox(this: OrchestrationDb): {
  pending: number
  sent: number
  dead: number
} {
  const row = this.db
    .prepare(
      `SELECT
         count(*) FILTER (WHERE sent_at IS NULL AND dead_at IS NULL) AS pending,
         count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
         count(*) FILTER (WHERE dead_at IS NOT NULL) AS dead
       FROM ledger_outbox`
    )
    .get() as { pending: number; sent: number; dead: number }
  return row
}
```

- [ ] **Step 4: Write `outbox-retention.ts`.** One timer, `setInterval` with `unref()` if the existing sweeps do that (match `corrections-sweep.ts`), a `sweepOnce` that computes the cutoff from `now()` and calls both methods, and a log line only when it deleted something. It must never throw out of the timer.

- [ ] **Step 5: Run the tests until green,** then `… corepack pnpm tc:node`. Write output to a file and gate on `grep -c ' failed'` being 0.

- [ ] **Step 6: Wire it up** in `main-process-runtime-service.ts` next to `state.correctionsSweep`, holding the handle on `main-process-state.ts` the way the other sweeps are held. Comment why it sits there: same settled-state read, and it must not run before the drainer has had a chance to deliver.

- [ ] **Step 7: Commit.** `feat(alicorn): outbox retention — delivered rows expire, dead rows never do`. **The message must argue the dedupe boundary explicitly:** the server's unique key is what makes delivery exactly-once, so a client row only has to outlive the retry window; 30 days is far beyond it, and dead rows are exempt because a human still has to see them.

---

### Task 2 (LG4/ALC-101): A WSL check can actually be cancelled

**Files:**
- Modify: `src/main/wsl/wsl-runner.ts` (`WslSpec` gains `signal`, `runWslProcess` forwards it), `src/main/alicorn/diff-coverage/diff-coverage-check.ts` (`wslSpecForCheck` takes and passes the signal; surface `environmentResolved` in the failure detail)
- Test: `src/main/wsl/wsl-runner.test.ts` (or the existing WSL runner spec file), `src/main/alicorn/diff-coverage/diff-coverage-check.test.ts`

**Interfaces:**
- Consumes: `runProcess` already accepts `signal` and kills the process tree on abort. `runDiffCoverageCheck` already has `input.signal` and already passes it on the host branch (`diff-coverage-check.ts:86`).
- Produces:
  ```ts
  export type WslSpec = WslCommand & {
    distro?: string
    loginPath: WslLoginPath
    cwd?: string
    env?: Readonly<Record<string, string>>
    timeoutMs?: number
    maxOutputBytes?: number
    /** Aborts the guest process, not just the promise. */
    signal?: AbortSignal
  }
  function wslSpecForCheck(distro, worktreePath, command, timeoutMs, signal?: AbortSignal): WslSpec
  ```

- [ ] **Step 1: Write the failing test.** In the WSL runner's test file, assert that `runWslProcess` passes the `signal` it was given straight through to `runProcess` — the existing tests already stub or spy the child-process layer, so follow whatever mechanism is there rather than inventing one. Add a second assertion that a spec with no `signal` still calls through with `signal` undefined, so existing callers are provably unaffected.

- [ ] **Step 2: Run it and watch it fail** (the property does not exist yet).

- [ ] **Step 3: Implement.** Add `signal?: AbortSignal` to `WslSpec` with the doc comment above, and forward `signal: spec.signal` in the `runProcess` call inside `runWslProcess`. Nothing else in that file changes.

- [ ] **Step 4: Thread it at the call site.** `wslSpecForCheck` gains a fifth parameter `signal?: AbortSignal` and sets it on the returned spec; the one call at `diff-coverage-check.ts:79` passes `input.signal`. Add a test in the diff-coverage spec that an aborted signal reaches the WSL branch.

- [ ] **Step 5: Surface the environment probe.** When the command stage fails, today's `detail` cannot distinguish a guest PATH probe failure (exit 127, command not found) from a real test failure. Include `WslResult.environmentResolved` in the detail string for the WSL branch only. Add a test asserting the detail says which it was.

- [ ] **Step 6: Run the affected suites and the typecheck,** output to a file, gate on `grep -c ' failed'` being 0. Run the ratchet suite too, since `wsl-runner.ts` is guarded by one.

- [ ] **Step 7: Commit.** `fix(alicorn): a WSL-hosted required check honours cancellation`.

---

### Task 3 (LG4/ALC-102): Read a stored context capture back

**Files:**
- Modify: `cloud/packages/control-plane-contract/src/ledger.ts` (a read shape), `cloud/apps/ledger-api/src/context-captures-repository.ts` (+ a list function), `cloud/apps/ledger-api/src/ledger-routes.ts` (the route)
- Test: `cloud/apps/ledger-api/src/ledger-routes-postgres.test.ts` (or a sibling Postgres spec beside it, matching how that file sets up its schema and pool)

**Interfaces:**
- Produces:
  ```ts
  // control-plane-contract/src/ledger.ts — distinct from ContextCaptureInputSchema, which is the write shape
  export const ContextCaptureReadSchema = z.object({
    dispatchId: z.string(),
    createdAt: z.string(),
    promptBytes: z.number().int(),
    // Why both, and why nullable: the write side takes exactly one of prompt/promptPath.
    // A reader must render either, and say plainly when the prompt was spilled to a file
    // rather than showing an empty box.
    prompt: z.string().nullable(),
    promptPath: z.string().nullable(),
    contextSlice: z.unknown().nullable()
  })
  export type ContextCaptureRead = z.infer<typeof ContextCaptureReadSchema>
  export const ContextCaptureListSchema = z.object({ captures: z.array(ContextCaptureReadSchema) })
  // ledger-api/src/context-captures-repository.ts
  export function listContextCapturesForRun(c: pg.PoolClient, runId: string): Promise<ContextCaptureRead[]>
  ```
- Route: `GET /v1/ledger/runs/:runId/context-captures`, **oldest first** — the reading order of a run. Scoped by run, not by repo and branch, because the inspector is opened from a run and a branch's provenance can span several.

- [ ] **Step 1: Write the failing Postgres test** in the ledger-api Postgres spec, following exactly how the neighbouring tests build their schema, pool and tenant context (they use `withTenant` and the forced-RLS role — do not reach around it):
  - two captures written for one run come back oldest first
  - a capture stored with `prompt` returns `prompt` set and `promptPath` null
  - a capture stored with `promptPath` returns `promptPath` set and `prompt` null, so a UI can say the prompt was spilled to a file
  - a capture belonging to another tenant is not returned
  - an unknown run returns an empty array, not a 404

- [ ] **Step 2: Run it and watch it fail.** With `ALICORN_TEST_POSTGRES_URL` set, or the suite skips and proves nothing. Start the database first: `docker start alicorn-test-pg`.

- [ ] **Step 3: Add the contract shape,** then the repository function (parameterised SQL, ordered by `created_at ASC, dispatch_id ASC` so the order is total and stable), then the route, registered beside the existing provenance route and using the same `requireTenant`-provided auth context.

- [ ] **Step 4: Run the ledger-api suite green, then `pnpm --dir cloud typecheck` and `pnpm --dir cloud -r build`.** Output to a file, gate on `grep -c ' failed'` being 0.

- [ ] **Step 5: Commit.** `feat(ledger-api): read a run's context captures back`.

---

## Self-review

- **Spec coverage.** ALC-99 → Task 1 (retention rule, dead rows exempt, the count metric, dedupe argued in the commit). ALC-101 → Task 2 (signal on `WslSpec`, forwarded, threaded at the call site, plus the `environmentResolved` minor folded in as the ticket asks). ALC-102 → Task 3 (read shape distinct from the write shape, run-scoped route oldest-first, Postgres test that skips without the URL).
- **Independence.** The three tasks share no file. Task 1 is desktop SQLite plus startup wiring, Task 2 is desktop WSL plus diff coverage, Task 3 is entirely under `cloud/`. They may be reviewed in any order, and none blocks another.
- **Ownership.** All three are in the Ledger lane. None touches the Members pane, the Interface tab model, the rebrand, or anything else Nghia holds.
- **Types.** `OrchestrationDb` methods are attached through `attachLedgerOutboxMethods`, so both new methods must appear in `LedgerOutboxMethods` or the call sites will not typecheck. `ContextCaptureRead` is the only new exported contract type and nothing else renames.
- **The one thing that would make this plan wrong:** if retention deleted a row the drainer had marked sent but the server had in fact rejected. It cannot — a rejected row is marked dead, not sent, and dead rows are exempt at the SQL level, not by convention.
