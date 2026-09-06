# Ledger Completion & Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ledger honest and measurable: a corrections watcher that records human amendments and reverts (`human_verdict`, `amended_after_ms`) so accept rate cannot drift up while quality drifts down; a durable record of every interruption (gates, questions, escalation offers) so `interruptions_per_completed_task` — the north-star metric — is a query and a CLI command; structured, tenant-tagged logs and a `/metrics` endpoint on both services.

**Architecture:** Everything the desktop learns still travels through the `ledger_outbox` → drainer → Ledger API path (CLAUDE.md: "anything written to the Ledger goes through the outbox"). Two new outbox kinds (`human_verdict_patch`, `interruption`) and two new Ledger API surfaces (`PATCH …/human-verdict`, `POST /v1/ledger/interruptions`) carry the new facts; a reports module answers the metric. The watcher never needs commit-author identity: a commit that lands after a step settled, touches that step's files, and is not covered by any dispatch of the same task is a human correction by construction (agents only act inside dispatches).

**Tech Stack:** Electron main (`gitExecFileAsync` for git — never raw `child_process`), the orchestration SQLite (v31 → v32 for the outbox CHECK), `cloud/apps/ledger-api` (hono + pg), the contract package (zod 3), CLI specs/handlers (`src/cli`), vitest.

**Spec:** `docs/alicorn/ARCHITECTURE.md` §6 (*Rules that keep the ledger honest*), §7 (*The corrections watcher is load-bearing*); `docs/alicorn/INFRASTRUCTURE.md` §6 (metrics that matter); `docs/alicorn/ROADMAP.md` v0.1 (Corrections watcher; exit criterion: `interruptions_per_completed_task` reportable per stage); `docs/alicorn/PROJECT-BRIEF.md` §02, §06.2; research `research/ledger-completion.md`. Plane: CW1, CW2, M1, M2 (module *Corrections watcher & Rulebook* / *Ledger* / *Cost & telemetry*, owner Huy).

## Global Constraints

- **Prerequisites (same owner, already planned in the desktop plan):** C2 (settlement enqueues `step_outcome`), C3 (drainer + `ledger-writer.ts`), B1's `alicornFetch`. This plan starts after C3 is on `main`; it does not re-plan them.
- **Ledger writes go through the outbox** — the watcher and the interruption capture enqueue; only the drainer talks to the Ledger API. **Reads** (the report) go main → `alicornFetch('ledger', …)`; the CLI never holds the token (CLI → RPC → main).
- **Append-only ledger**: the only UPDATEs on `step_outcomes` are the spend patch and, now, the human-verdict patch; `member_stage_stats` is written only by the outcome insert and the verdict patch (`last_amended_at`).
- **Git is run on the execution host** (`docs/reference/ssh-execution-boundary.md`): SSH worktrees whose provider is unreachable are `unverifiable` — skipped this tick, never "no correction found". Folder workspaces (no `.git`) are `skipped`, not clean. Never a raw `child_process` import (ratchet).
- **Git scan safety** (AGENTS.md): bounded `git log --since … -- <path>` on the current worktree only; no `--all`.
- **Wire changes additive**: new contract schemas, new routes, a new outbox kind (CHECK constraint widened by a v32 migration), optional fields on records.
- Alicorn-branded names; no AI attribution in commits; toolchain per the desktop ledger (`corepack pnpm test <file>` from the worktree root; `pnpm --dir cloud …` for services; `ALICORN_TEST_POSTGRES_URL` for Postgres suites).

## Decisions made in this plan

1. **Identity-free correction rule.** A commit is a human correction of step S when: its author time > S.`completed_at`; its touched paths intersect S.`files_modified`; and no `dispatch_contexts` row for S's task was active (`dispatched_at ≤ commit_time ≤ completed_at`, or still dispatched) at the commit's author time. `amended_after_ms = author_time − completed_at`. Window: 72 h after `completed_at` (constant `CORRECTION_WINDOW_MS`), scanned every 10 min.
2. **Revert classification:** a commit whose message matches `/^This reverts commit ([0-9a-f]{7,40})/m` and whose touched paths cover **all** of S.`files_modified` → `rejected`; otherwise `amended`.
3. **Reopened task (CW2) = a new dispatch on a task whose latest settled outcome was `succeeded`** — observable locally, no tracker polling. It marks the prior outcome `amended` with `amended_after_ms` = new `dispatched_at` − prior `completed_at`. External "issue reopened" webhooks are out of scope.
4. **Interruption kinds in v0.1: `gate`, `ask`, `escalation`.** Every `orchestration.ask` counts (directional metric; no human/agent discriminator exists). Permission prompts are a documented gap (live UI state only today) — recorded in the report response as `excluded: ['permission_prompt']`.
5. **`interruptions_per_completed_task` = Σ interruptions / count(distinct tasks with a settled outcome)**, filterable by `stageKey`, `projectId`, `memberId`, and a time range; both `succeeded` and `failed` count as completed.
6. **M2 without the OpenTelemetry SDK for now**: structured JSON request logs with `tenant_id` (the relay's `console.log(JSON.stringify(…))` house style) and a Prometheus text-format `GET /metrics` with hand-rolled counters (`gate_decisions_total{decision,reason}`, `ledger_write_duplicates_total`, `amended_within_window` gauge). INFRASTRUCTURE §6 gets a one-line status note; the OTel exporter is adopted when a customer needs Tempo/Grafana federation.
7. **Interruptions table is its own ledger table** (`step_interruptions`), not columns on `step_outcomes`.

## File structure

```
cloud/packages/control-plane-contract/src/ledger.ts     + HumanVerdictPatchSchema, InterruptionInputSchema, InterruptionsReportSchema; StepOutcomeRecordSchema + humanVerdict/amendedAfterMs
cloud/apps/ledger-api/src/schema-sql.ts                  + step_interruptions (RLS)
cloud/apps/ledger-api/src/step-outcomes-repository.ts    + patchStepOutcomeHumanVerdict; record mapping surfaces the verdict columns
cloud/apps/ledger-api/src/interruptions-repository.ts    insertInterruption (idempotent), getInterruptionsReport
cloud/apps/ledger-api/src/ledger-metrics.ts              counters + amended_within_window + Prometheus text
cloud/apps/ledger-api/src/ledger-routes.ts               + PATCH human-verdict, POST interruptions, GET reports/interruptions
cloud/apps/{control,ledger}-api/src/request-log.ts       structured JSON request logging middleware (duplicated by decision 7 of the tier-1 plan)
cloud/apps/{control,ledger}-api/src/app.ts               + request-log, GET /metrics (unauthenticated, local network only per INFRASTRUCTURE §9 network policy)
src/main/runtime/orchestration/db/schema/migrate-v32-alicorn.ts   widen ledger_outbox.kind CHECK; alicorn_correction_scans table
src/main/runtime/orchestration/db/alicorn/correction-scan-methods.ts
src/main/alicorn/corrections/corrections-watcher.ts      classifyCorrections() pure + scanWorktreeCorrections()
src/main/alicorn/corrections/git-history-reader.ts       commitsSince(), commitPaths() over gitExecFileAsync / SSH provider
src/main/alicorn/corrections/reopened-task-detector.ts
src/main/alicorn/corrections/corrections-sweep.ts        periodic sweep wiring (10 min)
src/main/alicorn/interruptions/interruption-capture.ts   enqueue gate/ask/escalation rows at settlement
src/main/alicorn/ledger/ledger-writer.ts                 + patchHumanVerdict, postInterruption (C3 file, Huy)
src/main/alicorn/ledger-outbox-drainer.ts                + two kinds
src/main/runtime/rpc/methods/alicorn-ledger.ts           ledger.report RPC (main → alicornFetch)
src/cli/specs/ledger.ts, src/cli/handlers/ledger/report-handlers.ts
docs/alicorn/INFRASTRUCTURE.md §6 note; ARCHITECTURE.md §6 (+ step_interruptions)
```

---

### Task 1 (CW1 server): `human-verdict` patch + record fields

**Files:** contract `ledger.ts`; ledger-api `schema-sql.ts` (no change), `step-outcomes-repository.ts`, `ledger-routes.ts`, `ledger-routes-postgres.test.ts`.

**Interfaces:**
```ts
export const HumanVerdictPatchSchema = z.object({
  humanVerdict: z.enum(['accepted', 'rejected', 'amended']),
  amendedAfterMs: z.number().int().nonnegative().nullable().default(null),
  source: z.enum(['follow_up_commit', 'revert', 'reopened_task', 'manual']).default('manual')
})
// StepOutcomeRecordSchema gains: humanVerdict: z.enum([...]).nullable(), amendedAfterMs: z.number().int().nullable()
export function patchStepOutcomeHumanVerdict(pool, tenantId, id, patch: HumanVerdictPatch): Promise<'patched' | 'not_found' | 'already_set'>
// UPDATE step_outcomes SET human_verdict=$1, amended_after_ms=$2 WHERE id=$3 AND human_verdict IS NULL RETURNING member_id, stage_key, project_id;
// when the row has member_id: UPDATE member_stage_stats SET last_amended_at = now(), updated_at = now() WHERE (tenant_id, member_id, stage_key, project_id) match — same transaction.
```
Route: `PATCH /v1/ledger/step-outcomes/:id/human-verdict` → 200 `{ id }` | 404 `not_found` | 409 `{ error: 'verdict_already_set' }` (append-only: a verdict is written once; a second, different signal is a new event — log it, do not overwrite).
- [ ] **Step 1: Failing Postgres tests** — patch sets verdict + `amended_after_ms`, stats `last_amended_at` set; second patch → 409; provenance record now carries `humanVerdict`; other tenant → 403/invisible.
- [ ] **Step 2: Implement. Step 3: PASS + typecheck. Step 4: Commit** `feat(ledger-api): human-verdict patch, verdict fields on outcome records`.

---

### Task 2 (M1 server): `step_interruptions` + report

**Files:** contract `ledger.ts`; ledger-api `schema-sql.ts`, `interruptions-repository.ts`, `ledger-routes.ts`, tests.

```sql
CREATE TABLE IF NOT EXISTS step_interruptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, task_id TEXT NOT NULL, dispatch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gate','ask','escalation')),
  source_id TEXT NOT NULL,             -- gate id / question id / dispatch id (escalation)
  resolved_by TEXT, occurred_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, source_id));  -- exactly-once
```
```ts
export const InterruptionInputSchema = z.object({ runId, taskId, dispatchId, kind: z.enum(['gate','ask','escalation']), sourceId, resolvedBy: z.string().nullable().default(null), occurredAt: z.string().datetime() })
export const InterruptionsReportSchema = z.object({
  filters: z.object({ stageKey: z.string().optional(), projectId: z.string().optional(), memberId: z.string().optional(), since: z.string().datetime().optional(), until: z.string().datetime().optional() }),
  completedTasks: z.number().int(), interruptions: z.number().int(), perCompletedTask: z.number(),
  byKind: z.record(z.number().int()), byStage: z.array(z.object({ stageKey: z.string(), completedTasks: z.number().int(), interruptions: z.number().int(), perCompletedTask: z.number() })),
  excluded: z.array(z.literal('permission_prompt'))
})
export function insertInterruption(pool, tenantId, input): Promise<{ id: string; duplicate: boolean }>   // ON CONFLICT DO NOTHING + select
export function getInterruptionsReport(pool, tenantId, filters): Promise<InterruptionsReport>
// completedTasks: COUNT(DISTINCT task_id) FROM step_outcomes WHERE filters (stage_key/project_id/member_id/created_at range)
// interruptions: COUNT(*) FROM step_interruptions i JOIN step_outcomes o ON (o.tenant_id,o.task_id,o.dispatch_id)=(i.tenant_id,i.task_id,i.dispatch_id) WHERE same filters (joined so stage/member filters apply)
```
Routes: `POST /v1/ledger/interruptions` → 201/200 `{ id, duplicate }`; `GET /v1/ledger/reports/interruptions?stageKey&projectId&memberId&since&until` → `InterruptionsReport`.
- [ ] Failing Postgres tests: three kinds inserted; duplicate `(kind, sourceId)` → 200; report for 2 completed tasks with 3 interruptions → `perCompletedTask 1.5`, `byKind`, `byStage`; filters narrow; `excluded` present. Implement; commit `feat(ledger-api): step interruptions and the interruptions-per-completed-task report`.

---

### Task 3 (M2): request logging and `/metrics` on both services

**Files:** Create `src/request-log.ts` in both apps (same file, decision 7 of the tier-1 plan), ledger-api `src/ledger-metrics.ts`, control-api `src/control-metrics.ts` (request counters only); modify both `app.ts`; docs INFRASTRUCTURE §6 status note.
```ts
// request-log.ts — registered before requireTenant; logs after the response: one JSON line
// { ts, service, method, path, status, duration_ms, tenant_id: c.get('auth')?.tenantId ?? null, request_id }
export function requestLog(service: string): MiddlewareHandler<…>
// ledger-metrics.ts
export class LedgerMetrics { incLedgerWriteDuplicate(); incGateDecision(decision: string, reason: string); setAmendedWithinWindow(n: number); renderPrometheus(): string }
// wiring: insertStepOutcome duplicate → incLedgerWriteDuplicate(); gate_decision/gate_reason from each inserted outcome → incGateDecision; amended_within_window refreshed on each /metrics scrape via SELECT count(*) FROM step_outcomes WHERE human_verdict='amended' AND created_at > now() - interval '7 days'
```
`GET /metrics` returns `text/plain; version=0.0.4`; unauthenticated (INFRASTRUCTURE §9: reachable only inside the network policy) — compose does **not** publish it on the host port list.
- [ ] Failing tests: `app.test.ts` — a request produces one JSON log line with `tenant_id`; ledger Postgres test — two duplicate posts → `ledger_write_duplicates_total 1` on `/metrics`; `amended_within_window` reflects a patched row. Implement; commit `feat(cloud): structured request logs with tenant_id and a Prometheus /metrics endpoint`.

---

### Task 4 (desktop substrate): outbox v32 + writer/drainer kinds

**Files:** `src/main/runtime/orchestration/db/contract-constants.ts` (`SCHEMA_VERSION 32`), `schema/migrate-v32-alicorn.ts` (SQLite cannot alter a CHECK: recreate `ledger_outbox` with kinds `+ 'human_verdict_patch', 'interruption'` copying rows — use the codebase's existing table-rebuild idiom from `migrate-v2-v12.ts`; add `alicorn_correction_scans (worktree_id TEXT PRIMARY KEY, last_scanned_at TEXT NOT NULL, last_commit TEXT)`), `db/alicorn/ledger-outbox-methods.ts` (kind union), `db/alicorn/correction-scan-methods.ts` (`getCorrectionScan`, `setCorrectionScan`), `src/main/alicorn/ledger/ledger-writer.ts` (+ `patchHumanVerdict(outcomeId, patch)`, `postInterruption(input)`), `src/main/alicorn/ledger-outbox-drainer.ts` (two branches).
- [ ] Tests: migration from a v31 DB keeps existing outbox rows and accepts the new kinds; drainer routes each kind to the writer; writer posts the right paths. Commit `feat(alicorn): outbox kinds for human verdicts and interruptions (SQLite v32)`.

---

### Task 5 (CW1): git history reader + correction classifier

**Files:** Create `src/main/alicorn/corrections/git-history-reader.ts`, `corrections-watcher.ts`, tests (`corrections-watcher.test.ts` pure; `git-history-reader-real-git.test.ts` with a temp repo per `src/main/git/repo-branch-conflict-real-git.test.ts`).
```ts
export type CommitSummary = { sha: string; authorTime: number; subject: string; body: string; paths: string[] }
export function createGitHistoryReader(exec: (argv: string[]) => Promise<{ stdout: string }>): { commitsSince(sinceIso: string): Promise<CommitSummary[]> }
// git log --since=<iso> --date=iso-strict --pretty=format:%H%x1f%aI%x1f%s%x1f%b%x1e --name-only  (parse records split on \x1e; paths follow the body)
export type SettledStep = { outcomeId: string; taskId: string; dispatchId: string; completedAt: number; filesModified: string[] }
export type DispatchSpan = { taskId: string; dispatchedAt: number; completedAt: number | null }
export type Correction = { outcomeId: string; verdict: 'amended' | 'rejected'; amendedAfterMs: number; source: 'follow_up_commit' | 'revert'; sha: string }
export const CORRECTION_WINDOW_MS = 72 * 3_600_000
export function classifyCorrections(steps: SettledStep[], commits: CommitSummary[], spans: DispatchSpan[], now: number): Correction[]   // decision 1 & 2; one correction per step (earliest qualifying commit)
```
- [ ] Failing tests: pure classifier — commit inside window touching a reported file, no covering dispatch → `amended` with the right `amendedAfterMs`; commit during a later dispatch of the same task → none; outside window → none; revert covering all files → `rejected`; partial revert → `amended`; real-git reader parses two commits with paths. Implement; commit `feat(alicorn): corrections watcher — identity-free classification of follow-up commits and reverts`.

---

### Task 6 (CW1/CW2): sweep wiring + reopened-task detector

**Files:** Create `src/main/alicorn/corrections/corrections-sweep.ts`, `reopened-task-detector.ts`, tests; modify `main-process-runtime-service.ts`/`main-process-state.ts` (start/stop, additive one-liners — shared-file rule).
```ts
export function startCorrectionsSweep(deps: { getDb; runtime; intervalMs?: number /* 600_000 */; now?: () => number }): { stop(); tickOnce(): Promise<{ scanned: number; corrections: number; skipped: Array<{ worktreeId: string; reason: 'not_a_git_worktree' | 'unverifiable' }> }> }
// tick: settled dispatches with completed_at within CORRECTION_WINDOW_MS (join worker_dispatches for worktree_id); group by worktree; resolve the worktree and its git route (runtimeGitRouteForTarget); local → gitExecFileAsync; ssh → provider.exec (null provider → unverifiable, skip); no .git → skipped; since = min(completed_at) of that worktree's steps minus 1 min; classify; for each correction: db.enqueueLedgerOutbox({ kind: 'human_verdict_patch', dedupeKey: `human_verdict_patch:${outcomeId}`, payload: { outcomeId, humanVerdict, amendedAfterMs, source } }); setCorrectionScan(worktreeId, now).
// outcomeId: the drainer stored the ledger id when it posted the step_outcome → C3 must persist it: add column alicorn_dispatch_ledger (dispatch_id PK, outcome_id) written by the drainer on 201/200 (Task 4 migration adds it).
export function detectReopenedTasks(db: OrchestrationDb, since: string): Array<{ priorDispatchId: string; newDispatchedAt: string; priorCompletedAt: string }>  // new dispatch_contexts row on a task whose latest completed dispatch succeeded
```
- [ ] Tests: in-memory DB + fake reader/route: local worktree with a qualifying commit → one outbox row; SSH unreachable → skipped, no row, no scan stamp; folder workspace → skipped; reopened detector → one row `source 'reopened_task'`. Commit `feat(alicorn): corrections sweep across worktrees; reopened-task detection`.

---

### Task 7 (M1 desktop): interruption capture

**Files:** Create `src/main/alicorn/interruptions/interruption-capture.ts` + test; modify `src/main/runtime/orchestration/lifecycle-reconciliation.ts` (after a successful `settleWorkerReport`, call `enqueueInterruptionsForDispatch(db, { runId, taskId, dispatchId })`) — this is a Ledger-module edit of a shared orchestration file; keep it to one call.
```ts
export function enqueueInterruptionsForDispatch(db: OrchestrationDb, ids: { runId; taskId; dispatchId }): number
// gates: SELECT id, created_at FROM decision_gates WHERE task_id=? AND created_at BETWEEN dispatched_at AND completed_at → kind 'gate', sourceId=id, resolvedBy = null (no column today)
// asks: questions rows for the task in the same span → kind 'ask'
// escalation: alicorn_task_strategy.escalation_offered_at within the span → kind 'escalation', sourceId = dispatchId
// each → enqueueLedgerOutbox({ kind: 'interruption', dedupeKey: `interruption:${kind}:${sourceId}`, payload: InterruptionInput })
```
- [ ] Tests: a dispatch with 2 gates, 1 ask, 1 escalation → 4 outbox rows; re-run → 0 new (dedupe). Commit `feat(alicorn): record gates, questions and escalation offers as ledger interruptions`.

---

### Task 8 (M1 CLI): `alicorn ledger report`

**Files:** Create `src/main/runtime/rpc/methods/alicorn-ledger.ts` (`ledger.report` RPC: params `{ stageKey?, projectId?, memberId?, since?, until? }` → `alicornFetch('ledger', '/v1/ledger/reports/interruptions?…')` → `InterruptionsReport`; `control_plane_unconfigured` → structured error), register it in the RPC method list; `src/cli/specs/ledger.ts` (`{ path: ['ledger','report'], usage: 'orca ledger report [--stage <key>] [--project <id>] [--member <id>] [--since <iso>] [--until <iso>] [--json]' }` — the binary name follows the rebrand plan), `src/cli/handlers/ledger/report-handlers.ts` (`client.call('ledger.report', …)`, text formatter: headline `interruptions per completed task: 1.50 (3 / 2)`, then a per-stage table, then `excluded: permission_prompt`); tests for spec + handler with a mocked client; a bundled skill-guide note.
- [ ] Commit `feat(alicorn): ledger report — interruptions per completed task (RPC + CLI)`.

---

### Task 9: docs

**Files:** `docs/alicorn/ARCHITECTURE.md` §6 (+ `step_interruptions`, verdict source), `docs/alicorn/INFRASTRUCTURE.md` §6 (status: JSON logs + Prometheus text now; OTel exporter later), `cloud/README.md` (metrics endpoint), CLAUDE.md *Working in this repo* (+ "gates/asks/escalations are recorded as interruptions at settlement; the metric is `alicorn ledger report`").
- [ ] Commit `docs(alicorn): interruptions model, corrections watcher, metrics status`.

---

## Self-review

- **Coverage.** CW1 (Tasks 1, 4, 5, 6), CW2 (Task 6 reopened + Task 5 revert + Task 3 metric), M1 (Tasks 2, 7, 8), M2 (Task 3). ROADMAP v0.1 exit criterion (metric reportable per stage) → Task 8. ARCHITECTURE §7 "until the corrections watcher ships, advisory-only" — the gates plan (GP) depends on this plan's Task 6 landing.
- **Placeholders.** Each task has interfaces, SQL/commands, test cases, commit. Task 6's reliance on a stored ledger outcome id is made explicit (new table in Task 4).
- **Types.** `HumanVerdictPatch`/`InterruptionInput` are defined once in the contract and mirrored by the desktop writer; `Correction.source` values equal the contract's `source` enum; kinds `gate|ask|escalation` identical in table, schema and capture.
- **Order.** 1 → 2 → 3 (server; parallel with 4) → 4 → 5 → 6 → 7 → 8 → 9. Requires C2/C3 (desktop plan) on `main` before Task 4.
