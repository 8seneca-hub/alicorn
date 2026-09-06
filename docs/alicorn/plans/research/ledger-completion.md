# Ledger completion & measurement — plan research (CW1, CW2, M1, M2)

Scope: Plane CW1 (corrections watcher — follow-up commits), CW2 (reverts/reopens → amended;
`amended_within_window` metric), M1 (`interruptions_per_completed_task` report + CLI), M2
(OTel/observability in cloud). Research only — nothing in `src/`, `cloud/` was modified.

## 0. Load-bearing fact: the dependency chain is not built yet

Only **Task 5 (C1)** of `docs/alicorn/plans/2026-09-06-tier-1-desktop.md` is implemented in this
worktree: the SQLite v31 schema (`ledger_outbox`, `alicorn_task_strategy`,
`alicorn_dispatch_members` — `src/main/runtime/orchestration/db/alicorn/{ledger-outbox-methods,
task-strategy-methods,dispatch-member-methods}.ts`, wired via
`src/main/runtime/orchestration/db/schema/migrate-v31-alicorn.ts` and
`create-alicorn-tables-sql.ts`). Verified: `enqueueLedgerOutbox`/`listDueLedgerOutbox`/
`markLedgerOutboxSent`/`markLedgerOutboxFailed` exist and match the plan's interfaces exactly.

**Not yet implemented** (confirmed by absence, not just unread): Task 6 (C2, enqueue outbox row
inside `settleWorkerReportInTransaction` — `grep enqueueLedgerOutbox
src/main/runtime/orchestration/db/dispatch-context/worker-report-settlement.ts` returns nothing),
Task 7 (C3, `src/main/alicorn/{step-outcome-builder,ledger-outbox-drainer}.ts`,
`src/main/alicorn/ledger/ledger-writer.ts` — the whole `src/main/alicorn/` directory is empty),
Task 8 (C4, context capture), Task 9 (C5, cost attribution), and all of B1–B4 (no `ALICORN_*` env
var, no control-plane client, no Members IPC anywhere under `src/`). The cloud side is further
along: `cloud/apps/ledger-api` and `cloud/apps/control-api` are fully scaffolded (Task 7/8 of the
control-plane plan), with real routes, repositories and Postgres tests.

**Consequence for this ticket:** CW1's "PATCH to the Ledger API through the outbox — the desktop
never calls the ledger directly" requires C2+C3 to exist first. The desktop plan's own sequencing
note (line 504) already assigns this: *"Huy: C2 → C3 → C5 → D5 → D7 → E1."* Since this ticket
(CW1/CW2/M1/M2) is also owned by Huy, the task decomposition below treats C2/C3 as **prerequisite
work that belongs to this same effort**, not as a separate already-done substrate.

## 1. Existing code map

| Concern | File : line | Signature / note |
|---|---|---|
| Async git exec (local + WSL) | `src/main/git/command-runner/git-exec-file.ts:1` | `gitExecFileAsync(args: string[], options: GitExecOptions): Promise<{stdout,stderr}>` — handles WSL routing, Windows env prep, SSH-policy env, admission queueing, timeout |
| Per-target git exec dispatch (local vs SSH) | `src/main/runtime/runtime-git-generation-context.ts:22` | `pullRequestDraftGitExec(target: RuntimeGitTarget, route: RuntimeGitRoute)` — SSH: `provider.exec(argv, worktreePath, {timeoutMs})`; local: `gitExecFileAsync(argv, {cwd, ...localGitOptionsForTarget(target), admissionTier:'interactive'})`. **This is the pattern CW1 should copy** for "run git for this worktree wherever it lives." |
| Route resolution (local / ssh / runtime) | `src/main/runtime/runtime-git-command-target.ts:66` | `runtimeGitRouteForTarget(target): RuntimeGitRoute` (`{kind:'local'}` / `{kind:'ssh', connectionId, provider}` — `provider: null` = unreachable, never "run locally"); `requireRuntimeGitProvider(target)` throws rather than silently falling back (rule 1 of `docs/reference/ssh-execution-boundary.md`) |
| Worktree resolution by id | `src/main/runtime/orca-runtime-list-managed-worktrees.ts:117` | `showManagedWorktree(selector): Promise<Pick<Worktree,'id'\|'repoId'\|'path'>>` — used via `id:<worktreeId>` selector in the drainer's plan (Task 7) |
| dispatch → worktree mapping | `src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts:112-130` | `worker_dispatches(dispatch_id PK, worktree_id, start_options, ...)`; `dispatch_contexts(id PK, task_id, dispatched_at, completed_at, ...)` at `create-graph-tables-sql.ts:120-144` — no `worktree_id` on `dispatch_contexts` itself, only on `worker_dispatches` |
| Settlement transaction (where outbox enqueue must go) | `src/main/runtime/orchestration/db/dispatch-context/worker-report-settlement.ts` | `settleWorkerReportInTransaction` — plan's insertion point is immediately before `RELEASE settle_worker_report` on the success path |
| `filesModified` provenance | `src/main/runtime/orchestration/lifecycle-reconciliation.ts:270-287` | **Self-reported by the agent**, not git-derived: `orca orchestration send --type worker_done --files-modified <csv>` (`src/main/ssh/ssh-remote-orchestration-send.ts:41-76`) is JSON-encoded into `result.filesModified` verbatim, no verification against `git diff`. `result.completedAt = new Date().toISOString()` — server (main-process) wall clock, this is the anchor CW1 needs. |
| Decision gates (DB) | `src/main/runtime/orchestration/db/decision-gates/decision-gate-store.ts:9,88` | `createGate({taskId, question, options, requester?})`, `resolveGate(gateId, resolution)`; table `decision_gates(id, run_id, task_id, question, options, status CHECK(pending\|resolved\|timeout), resolution, created_at, resolved_at)` — `create-graph-tables-sql.ts:150-161`. **No `resolved_by` column** (ARCHITECTURE §6's sketch has one; the real table doesn't) — answerer identity only inferable from the terminal handle calling `gateResolve`. |
| Gate RPC methods | `src/main/runtime/rpc/methods/orchestration-gates.ts:24-42,109-181` | `orchestration.gateCreate` (`GateCreateParams{task,question,options?,from?,run?}`), `orchestration.gateResolve` (`GateResolveParams{id,resolution,from?,run?}`), `orchestration.gateList` |
| Ask (agent→agent/human question) | `src/main/runtime/rpc/methods/orchestration-ask-methods.ts:9` | `orchestration.ask` — creates a `createQuestion` row, blocks until `answered`/timeout/cancel. **No structural field distinguishes "asked a human" from "asked another agent/coordinator"** — `askerHandle=from`, target resolved via active dispatch/run, not a human/agent discriminator. |
| Agent status incl. permission prompts | `src/shared/agent-title-core.ts` | `AgentStatus = 'working' \| 'permission' \| 'idle'` — derived live from terminal title/OSC/hook parsing (`src/shared/agent-status-observation.ts` — origins `hook\|osc\|title\|process\|launch\|orchestration`). **This is a live UI status, not a persisted event log**: nothing today counts or timestamps *occurrences* of a pane entering `permission`, only the current state. A durable "permission interruption" count needs new instrumentation. |
| Task providers (issue reopen signal) | `src/shared/task-providers.ts:1` | `TaskProvider = 'github'\|'gitlab'\|'linear'\|'jira'`. `Worktree.linkedIssue/linkedPR` (`src/shared/worktree/types.ts:83-84`), `linkedGitLabIssue` (:99), `linkedWorkItem: WorkspaceLinkedItem` (:103, has `.type: 'issue'\|'pr'\|'mr'`). **No existing "issue reopened" observation** — `reopen` in the codebase is only an Orca-initiated GitLab MR mutation (`src/main/gitlab/merge-request-state-mutations.ts:57` `reopenMR`), never an inbound signal Orca watches for. |
| Ledger API schema | `cloud/apps/ledger-api/src/schema-sql.ts:3-24` | `step_outcomes` has `human_verdict TEXT CHECK (IN ('accepted','rejected','amended'))` and `amended_after_ms INTEGER` columns **already in the schema**, but **no write path populates them** — `insertStepOutcome` (`step-outcomes-repository.ts:65`) never sets them (defaults to `NULL`), and there is no `PATCH .../human-verdict` route in `ledger-routes.ts:1-69` (only `POST step-outcomes`, `PATCH .../spend`, `POST step-verifications`, `POST context-captures`, `GET provenance`, `GET runs/:id/cost`). **This PATCH route is CW1's main net-new surface.** |
| `member_stage_stats` | `cloud/apps/ledger-api/src/member-stage-stats.ts:13` | `upsertMemberStageStats(client, {tenantId,memberId,stageKey,projectId,accepted})` — increments `runs`/`accepted`/`accept_rate` on every outcome insert. **Has `last_amended_at`/`level` columns in schema (`schema-sql.ts:46-51`) but nothing ever writes them.** CW1/CW2 need to update `last_amended_at` when a later PATCH sets `human_verdict='amended'`; `level` is v1.0 gate-policy territory, out of scope here. |
| Wire contract (zod) | `cloud/packages/control-plane-contract/src/ledger.ts:7-27,56-65` | `StepOutcomeInputSchema` has no `humanVerdict`/`amendedAfterMs` fields at all — needs a new `HumanVerdictPatchSchema` (analogous to `SpendPatchSchema:29`) |
| Relay's own observability (closest thing to M2's target, but *not* OTel) | `cloud/apps/relay/src/relay-observability.ts:130-144` | `class RelayObservability implements RelayRuntimeObserver` — hand-rolled in-memory deltas + `write: MetricWriter = (entry) => console.log(JSON.stringify(entry))`. No `@opentelemetry/*`, no `prom-client` anywhere in `cloud/` (`grep -rn opentelemetry\|prom-client cloud/**/package.json` → zero hits). `control-api`/`ledger-api` `app.ts` have only `console.error('[alicorn-ledger-api] unhandled', error)` — **zero structured logging, zero tenant_id-tagged logs, zero metrics today.** |
| Desktop's own tracer (not OTel either, but the local analog) | `src/main/observability/tracer.ts`, `instrumentation.ts` | Hand-rolled `startSpan`/`withSpan`; `withGitSpan` wraps every git exec. Confirms Orca's house style for "traces" is a custom lightweight sink, not vendoring an OTel SDK client-side — cloud services are free to choose OTel since they're server processes with no bundle-size constraint. |
| CLI report idiom | `src/cli/specs/orchestration.ts:264-269`, `src/cli/handlers/orchestration/gate-handlers.ts:37-59` | Spec: `{path:['orchestration','gate-list'], summary, usage, allowedFlags:[...GLOBAL_FLAGS,'task','status','run','from']}`. Handler: `'orchestration gate-list': async ({flags,client,cwd,json}) => { const result = await client.call<{gates:...}>('orchestration.gateList', {...}); printResult(result, json, (value) => /* text formatter */) }`. Mutations go through `callOrchestrationMutation` (`mutation-request.ts`) instead of `client.call` directly. |
| RPC method registration | `src/main/runtime/rpc/methods/orchestration-gates.ts:44-50` + `core.ts` | `defineMethod({name, params: ZodSchema, handler: (params, ctx) => ...})`; method arrays like `ORCHESTRATION_GATE_METHODS: RpcMethod[]` are exported per file and aggregated centrally — new work should add `ALICORN_LEDGER_METHODS` (or similar) the same way, calling out to the Ledger API via **main**, never exposing the bearer token to the CLI process directly (per CLAUDE.md: "the CLI never holds the token" — must go CLI → RPC → main → `alicornFetch`). |
| Test git fixtures (temp repo idiom) | `src/main/git/repo-branch-conflict-real-git.test.ts:1-42` | `mkdtempSync(join(tmpdir(), 'orca-branch-conflict-'))`; helper `const git = (...args) => execFileSync('git', args, {cwd: repoPath, encoding:'utf8'})`; `git('init','--quiet')`, `git('config','user.name','Orca Test')`, `git('config','user.email','orca@example.test')`, `git('config','commit.gpgSign','false')`, `git('config','core.hooksPath','.git/no-hooks')`; cleanup via `tempPaths` array + `afterEach(() => rmSync(path,{recursive:true,force:true}))`. Naming convention: `*-real-git.test.ts` for tests that spawn a real git binary (vs in-memory SQLite tests for orchestration DB, which use `new OrchestrationDb(':memory:')`). |
| SSH: git-exec allowlist + execution boundary | `src/relay/git-exec-validator.ts:17-31`; `docs/reference/ssh-execution-boundary.md:5-16,54` | `ALLOWED_GIT_SUBCOMMANDS` includes `log`/`diff`/`rev-parse`/`show-ref`, unrestricted beyond `GLOBAL_DENIED_FLAGS` (`--output,-o,--exec-path,--work-tree,--git-dir`) — `git log` needs no special-casing on an SSH-hosted worktree. But "the execution host owns everything that touches execution": loss of contact → `unverifiable`, never `exited`; if disconnected, CW1's scan for that worktree cannot run this tick and must be skipped/deferred, never recorded as "no amendment found." |

## 2. Interruption model

### Proposed definition

An **interruption** is any point in a step's lifecycle where execution paused and a human had to act
before the agent could continue *or* before the step could be trusted as-is. Four kinds, each with a
distinct existing data source (none is currently aggregated into one place):

| Kind | Existing signal | Where it lives today | Gap to fill |
|---|---|---|---|
| **Decision gate** | `orchestration.gateCreate`/`gateResolve` | `decision_gates` (SQLite, per-run) — `status`, `resolution`, `created_at`, `resolved_at` | No `resolved_by` (who answered), no link to a `step_outcome`/`dispatch_id`, no propagation to the ledger at all today (ARCHITECTURE §6 says gates stay client-side in tier 1: `-- v1.0 (gate policy); tier 1 keeps Orca's client-side decision_gates`). Counting requires reading Orca's own SQLite (`decision_gates` rows created since the task's dispatch), not the Postgres ledger. |
| **Question to a human** | `orchestration.ask` | `questions` table (via `createQuestion`) — no human/agent discriminator on `askerHandle`/target | Ambiguous by construction: cannot tell "asked the coordinator" from "asked a human" without a convention (e.g. `to === undefined` or `to === run.coordinator_handle` when the coordinator is a human-attended terminal). Likely needs a policy default: count every `orchestration.ask` as an interruption **unless** answered by another orchestration dispatch (would need to check `answer_message_id`'s sender), which is imprecise. Flag as an open question below. |
| **Escalation offer** | `escalation_offered`/`escalation_accepted` (already in `step_outcomes` schema, `ledger.ts:24-25`) | Set by the not-yet-built context-ceiling watcher (Task 13/D4) | Already ledger-ready once D4 lands — no new column needed, just a query: `escalation_offered = true` (whether or not accepted) is one interruption. |
| **Permission prompt** | `AgentStatus === 'permission'` (title/hook/OSC derived) | Live-only, not persisted (see code map) | Needs new instrumentation: either count entries into `permission` state per dispatch (a counter incremented at the observation-sequencer boundary) or accept this is out of scope for v0.1 and defer — recommend **deferring** given the size of the change vs. the other three, and note it explicitly as a known gap in the metric rather than silently omitting it. |

`interruptions_per_completed_task` = `sum(interruptions across all kinds for a task's steps) /
count(distinct completed tasks)`, scoped by `stage_key`/`project_id`/`member_id` per the ticket's
ask. A "completed task" is a task whose current dispatch settled with `outcome IN
('succeeded','failed')` (both count as completed for the denominator — a failed task is still one
task that took N interruptions).

### Where each would be written

- **Gate/ask counts**: these live in Orca's local SQLite, not Postgres. Two options: (a) roll them
  up into the existing `step_outcome` write at settlement time (add `gates_count`, `asks_count`
  fields to `StepOutcomeInput` — additive, wire-compatible) computed from `decision_gates`/
  `questions` rows scoped to the dispatch's task between `dispatched_at` and `completed_at`; or (b)
  a new `interruptions` ledger table keyed by `(tenant_id, dispatch_id, kind)` with one row per
  event, giving richer per-kind breakdown for the report. **(b) is preferable** — it matches the
  ticket's own suggestion ("new table `interruptions`?") and keeps `step_outcomes` from becoming a
  wide catch-all; it also lets `human_verdict`/CW1 write into the *same* table shape conceptually
  (an "amended" verdict is itself a kind of after-the-fact interruption signal, though distinct
  enough to keep on `step_outcomes` per the existing schema). Recommend: new table
  `step_interruptions(id, tenant_id, run_id, task_id, dispatch_id, kind CHECK(gate|ask|escalation),
  gate_id, question_id, resolved_by, created_at)`, populated by the same outbox drainer path (new
  `ledger_outbox` kind `'interruption'`), one row enqueued per gate/ask resolution and per escalation
  offer.
- **Escalation offer**: already a column on `step_outcomes` (`escalation_offered`) — no new write
  path once D4 exists, just read it in the M1 report query.

## 3. Corrections watcher design inputs (CW1)

### Detection algorithm sketch

1. **Trigger.** Poll on an interval (reuse the drainer's cadence idiom — `intervalMs: 5_000` is too
   tight for a git-history scan; something like 5–15 minutes is more appropriate given it's a
   backstop, not a real-time signal). For each `step_outcomes` row (read from the Ledger API, or
   more cheaply: for each locally-settled dispatch in `dispatch_contexts` whose `completed_at` is
   within the configured window, e.g. last 24–72h, and whose `human_verdict` is still unset) that
   has a resolvable worktree:
   - Resolve `RuntimeGitTarget`/`RuntimeGitRoute` for the worktree (`runtimeGitRouteForTarget`).
     `kind:'local'` → run directly; `kind:'ssh'` with `provider: null` → skip this tick, log
     `unverifiable`, do not mark checked; `kind:'runtime'` → skip (not this process's job — v2.0
     multi-repo territory anyway).
   - Folder workspace (no `.git`, i.e. `resolveRuntimeGitTarget` fails or `worktree.git` absent) →
     skip permanently (not "no amendment," just "not applicable" — mirror D5's `skipped
     not_a_git_worktree` pattern at desktop plan Task 14 line 410).
2. **Git commands** (via `gitExecFileAsync`/`pullRequestDraftGitExec`-style dispatch, never a raw
   `child_process` call — AGENTS.md "Windows child processes"):
   ```
   git log --since="<completed_at ISO>" --pretty=format:'%H|%an|%ae|%aI|%s' -- <repo root>
   ```
   then for each candidate commit newer than `completed_at`:
   ```
   git show --name-only --pretty=format: <sha>
   ```
   to get its touched paths, intersected with `step_outcomes.files_modified` (bearing in mind
   `files_modified` is **agent self-reported**, not git-verified — a `git diff` between the
   dispatch's start and end commit, if that range is known, would be a more trustworthy path set
   than trusting the agent's own list; consider capturing the pre/post commit SHA at dispatch
   start/settlement in a future task and preferring that over `files_modified` when both exist).
3. **Window.** `amended_after_ms = commit_author_date_ms - completed_at_ms`. A configurable ceiling
   (INFRASTRUCTURE doesn't specify a number — treat as an org policy default, e.g. 24h, mirroring
   the "recent" windows used elsewhere in the codebase such as D4's "sessions active in the last 3
   minutes"). Reject/ignore commits outside the window (too late to attribute confidently to a
   correction of *this* step vs. unrelated later work).
4. **Identity rule — the hard part.** There is **no structural way to tell an agent-authored commit
   from a human one** in this codebase today (confirmed: no `GIT_AUTHOR_*` env override anywhere in
   `src/main`, and the user's own git convention explicitly forbids `Co-Authored-By` trailers —
   `docs/alicorn/plans/2026-09-06-tier-1-control-plane.md:23`, matching the global CLAUDE.md rule).
   Agent commits use whatever `git config user.name`/`user.email` is configured for that worktree —
   normally the **same identity as the human developer**, since "Execution is on the client" (agents
   run under the user's own git identity). Options, none clean:
   - **(a) Negative inference from timing, not identity.** Treat *any* commit landing after
     `completed_at` and touching `files_modified` as a correction candidate, regardless of author —
     because the agent that produced the step is not running anymore (its dispatch already
     `completed`/`succeeded`), so *any* commit in the window is necessarily either the human or a
     *new* dispatch. This sidesteps identity entirely and is the recommended default.
   - **(b) Distinguish "new dispatch continued the work" from "human amended it" by checking whether
     a new `dispatch_contexts` row for the same task exists covering that commit's timestamp** — if
     yes, it's not a correction, it's a new supervised step (which gets its own `step_outcome` row
     with its own verdict); if no active/settled dispatch for that task covers the commit's time,
     it's an out-of-band human commit → `amended`.
   - This makes (b) depend on (a)'s timing check plus a dispatch-coverage check, giving a precise
     rule without ever needing to solve commit-author identity: **"a commit after `completed_at`,
     touching `files_modified`-intersecting paths, with no dispatch_context row for that task active
     at the commit's author time, is a human correction."**
5. **What to PATCH.** New route `PATCH /v1/ledger/step-outcomes/:id/human-verdict` (mirrors the
   existing spend PATCH at `ledger-routes.ts:24-31`) with body `{humanVerdict: 'amended',
   amendedAfterMs: number}`; repository function `patchStepOutcomeHumanVerdict(pool, tenantId, id,
   patch)` mirroring `patchStepOutcomeSpend` (`step-outcomes-repository.ts:110-118`), additionally
   updating `member_stage_stats.last_amended_at = now()` in the same transaction when a memberId is
   present (mirrors the accept-rate upsert in `insertStepOutcome`). Desktop side: a new
   `ledger_outbox` kind (e.g. `'human_verdict_patch'`) added to the CHECK constraint in
   `create-alicorn-tables-sql.ts`, drained by the same `ledger-outbox-drainer.ts` (once it exists),
   never a direct `alicornFetch` call from the corrections-watcher module itself — it must go
   through the outbox, per CLAUDE.md ("Anything written to the Ledger goes through the outbox").

### CW2 — reverts and reopened tasks

- **Revert detection**: match commit messages against `/^This reverts commit ([0-9a-f]{7,40})/m`
  (standard `git revert` boilerplate; confirmed nowhere handled in this codebase today, safe to
  introduce). When the reverted SHA falls inside a step's `files_modified`-touching range for a
  settled outcome, mark that outcome `amended` (or arguably `rejected` — a revert is a stronger
  signal than an amendment; recommend treating a revert as `rejected` when it fully undoes the
  step's changes with no other edits, `amended` when partial — flag as an open question, since the
  schema's `human_verdict` enum is `accepted|rejected|amended`, ARCHITECTURE §6).
- **Reopened task — cheaper option available.** Rather than requiring per-provider (GitHub/GitLab/
  Jira/Linear) issue-state polling (none of which exists today — confirmed no "reopened" observation
  anywhere in `src/main/{github,gitlab,jira,linear}`), Orca's **own** dispatch history already
  encodes "reopened" for free: a **new `dispatch_contexts` row created for a task whose most recent
  settled step already has a `step_outcome` with `outcome='succeeded'`** is structurally a
  re-opening of completed work, observable entirely from the local orchestration DB with no
  external API calls. Recommend building this first (cheap, no new provider polling) and treating
  external-tracker "Issue reopened" webhooks/polling as a stretch goal, not required for the v0.1
  exit criterion.
- **`amended_within_window` metric** (INFRASTRUCTURE §6): a Postgres-side aggregate over
  `step_outcomes WHERE human_verdict = 'amended' AND created_at > now() - interval` — cheapest to
  compute at read time in `member-stage-stats.ts` or a new `ledger-metrics.ts`, exposed as a Prometheus
  gauge/counter once M2's OTel/metrics plumbing exists (see below); does not need its own table.

## 4. Extension points

- **`ledger-routes.ts`**: add `PATCH /v1/ledger/step-outcomes/:id/human-verdict` next to the
  existing spend PATCH (`ledger-routes.ts:24-31`), same `requireTenant`-gated pattern.
- **`ledger.ts` contract**: add `HumanVerdictPatchSchema = z.object({humanVerdict:
  z.enum(['accepted','rejected','amended']), amendedAfterMs: z.number().int().nonnegative().optional()})`
  next to `SpendPatchSchema` (`ledger.ts:29-32`).
- **`step-outcomes-repository.ts`**: add `patchStepOutcomeHumanVerdict`, mirroring
  `patchStepOutcomeSpend` (`:110-118`), plus the `member_stage_stats.last_amended_at` update.
  Extend `StepOutcomeRow`/`toStepOutcomeRecord` to surface `human_verdict`/`amended_after_ms`
  (currently absent from the mapped record at `step-outcomes-repository.ts:34-63` even though the
  DB columns already exist — the read side needs the field too, for the provenance panel and M1's
  report).
- **`ledger_outbox` kind CHECK** in `create-alicorn-tables-sql.ts` (currently `'step_outcome',
  'context_capture', 'spend_attribution', 'step_verification'`) needs a fifth kind for the human
  verdict patch and (if the `interruptions` table route is taken) a sixth for interruption rows.
- **New RPC methods** (main): `ledger.report` (query, `client.call` not `callOrchestrationMutation`)
  — fetches from the Ledger API via a to-be-built `alicornFetch('ledger', ...)` call in main,
  following the exact non-existence-yet caveat in §0. New CLI spec entry in
  `src/cli/specs/orchestration.ts` (or a new `src/cli/specs/ledger.ts` file, since this isn't an
  orchestration primitive) `{path:['ledger','report'], usage: 'orca ledger report [--stage <key>]
  [--project <id>] [--member <id>] [--json]', allowedFlags:[...GLOBAL_FLAGS,'stage','project',
  'member']}`, handler in a new `src/cli/handlers/ledger/report-handlers.ts` following
  `gate-handlers.ts`'s `client.call` + `printResult` shape.
- **Cloud observability**: `cloud/apps/control-api/src/app.ts` and `ledger-api/src/app.ts` both need
  a request-logging middleware (structured JSON, `tenant_id` from `c.get('auth')`) — currently only
  `app.onError` logs, and only the error, with no tenant context. Natural insertion point: a Hono
  middleware registered before `requireTenant` for latency/path, and after it for `tenant_id`.

## 5. Test idioms to copy

- **Real-git detection tests** (for CW1's core algorithm): `mkdtempSync(join(tmpdir(),
  'alicorn-corrections-'))` + the `execFileSync('git', ...)` helper shown in
  `src/main/git/repo-branch-conflict-real-git.test.ts:1-42` (init, config user.name/email,
  `commit.gpgSign false`, `core.hooksPath .git/no-hooks`) — build a repo, simulate a "settled step"
  commit at time T0, a second commit at T0+Δ touching the same file, assert the detector classifies
  it as amended within a configured window and not outside it. Use the same `afterEach` cleanup
  pattern with an accumulated `tempPaths` array.
- **Orchestration DB unit tests**: `new OrchestrationDb(':memory:')` (referenced throughout the
  desktop plan, e.g. Task 5/6/7's test steps) for anything touching `ledger_outbox`,
  `dispatch_contexts`, `decision_gates` without a real git repo or real Postgres.
- **Ledger API Postgres tests**: `describe.skip` gated on `ALICORN_TEST_POSTGRES_URL` (mirrors the
  relay's `ORCA_RELAY_TEST_POSTGRES_URL`), same `withTenant` pool pattern as
  `ledger-routes-postgres.test.ts` (exactly-once, provenance, tenant-isolation cases already
  modeled there — copy that file's shape for the new PATCH route's tests).
- **CLI handler tests**: `src/cli/specs/orchestration.test.ts` pattern for spec fixtures.

## 6. Constraints (cross-cutting, from AGENTS.md / CLAUDE.md)

- Git access must go through `gitExecFileAsync`/the `RuntimeGitTarget`/`RuntimeGitRoute` dispatch —
  never a raw `child_process` import (ratchet test fails on any new direct import).
- Never assume every worktree is a git worktree — folder workspaces have no `.git`; skip, don't error.
- SSH-hosted worktrees: git runs on the execution host, never falls back to local; a disconnected host reports `unverifiable`, never "no correction found."
- Anything written to the Ledger goes through `ledger_outbox` + the drainer — no direct
  `alicornFetch` from a new corrections-watcher module.
- No `Co-Authored-By`/AI-attribution trailers exist to lean on for identity — don't design around them.
- `tenant_id` + forced RLS on every new/touched Postgres table (`step_outcomes`, any new
  `step_interruptions` table). Wire changes additive only: optional new fields/columns, new RPC
  method names, no renaming/removing existing `StepOutcomeInput` fields.
- Windows: any subprocess beyond `gitExecFileAsync` (none currently anticipated) must go through
  `runProcess`/`spawnProcess`.

## 7. Risks & open questions

- **Sequencing risk**: CW1/CW2 cannot ship independently of C2 (settlement-time outbox enqueue) and
  C3 (drainer) landing first — unimplemented in this worktree today. The decomposition below treats
  them as in-scope prerequisites; flag to the controller that true scope exceeds "watcher + metric."
- **`files_modified` is agent self-reported**, not git-verified — a buggy/incomplete report makes
  CW1 blind to unreported files. Log as a known limitation; a stronger fix (capture start/end commit
  SHAs per dispatch and diff) is future work, out of scope here.
- **No human/agent identity discriminator in git.** The timing + dispatch-coverage rule (§3.4)
  avoids needing one but is imperfect (a human pairing live during a race window between
  `worker_done` and the next dispatch could misattribute) — acceptable for v0.1's advisory-only
  posture (ARCHITECTURE §7).
- **`orchestration.ask` human-vs-agent ambiguity** (§2) needs a controller decision before
  implementation: "any ask not resolved by another dispatch within N seconds" vs. simply counting
  every `ask` unconditionally (simpler, accepts slight overcounting — matches the metric's tolerance
  for directional rather than exact counts).
- **Permission-prompt interruptions have no persisted event log today.** Recommend scoping v0.1's
  metric to gates + asks + escalations and documenting the permission-prompt gap explicitly rather
  than building partial instrumentation under time pressure.
- **Revert vs. amend classification** (CW2, §3) is a product decision, not settled by ARCHITECTURE.md.
- **OTel is a genuinely new dependency surface for `cloud/`** — today's house style everywhere
  (relay, desktop) is hand-rolled JSON-to-stdout + custom span helpers, not a vendored SDK. Confirm
  with the controller whether INFRASTRUCTURE §6's "OpenTelemetry" is literal, or whether extending
  the relay's `console.log(JSON.stringify(...))` + `tenant_id` convention satisfies "structured JSON
  logs with tenant_id" without adding `@opentelemetry/*`. Recommend the latter for tier 1; defer real
  OTel until a customer needs Tempo/Grafana federation.

## 8. Suggested task decomposition (≤ 2 ew each)

All tasks ≤ 2 engineer-weeks; sequenced so later tasks depend only on earlier ones in this list.

1. **[Prereq, shared with C2/C3] Enqueue outbox row at settlement + drainer skeleton.** Files:
   `worker-report-settlement.ts` (add `enqueueLedgerOutbox` before `RELEASE settle_worker_report`),
   new `src/main/alicorn/{step-outcome-builder,ledger-outbox-drainer,ledger/ledger-writer}.ts`.
   Proving test: `worker-report-settlement-outbox.test.ts` (one row per settled report, none on
   duplicate) + `ledger-outbox-drainer.test.ts` (fake writer, backoff). *Blocking for everything
   below — flag to controller as a dependency to schedule or confirm already in flight.*

2. **[CW1] `human-verdict` PATCH route + contract + repository.** Files: `ledger.ts` (add
   `HumanVerdictPatchSchema`), `ledger-api/src/{ledger-routes.ts,step-outcomes-repository.ts}` (new
   `patchStepOutcomeHumanVerdict`, `member_stage_stats.last_amended_at` update), extend
   `toStepOutcomeRecord` to surface the fields. Proving test: `ledger-routes-postgres.test.ts` new
   case — PATCH sets `human_verdict`/`amended_after_ms`, stats update, tenant isolation holds.

3. **[CW1] Desktop corrections-watcher (timing + dispatch-coverage detection).** New
   `src/main/alicorn/corrections-watcher.ts` — pure function: given a settled step's `{completedAt,
   filesModified, worktree}` plus an injected git-log reader, returns amendment verdicts; reuses
   `runtimeGitRouteForTarget`/`pullRequestDraftGitExec`-style dispatch for actual git calls. Proving
   test: real-git fixture per §5 — commit after window → none; commit inside window touching a
   reported file → `amended` with correct `amendedAfterMs`; folder workspace/SSH-unreachable →
   skipped, not treated as clean.

4. **[CW1] Wire the watcher into the outbox.** New `ledger_outbox` kind `'human_verdict_patch'`
   (CHECK update in `create-alicorn-tables-sql.ts`), drainer branch calling
   `LedgerWriter.patchHumanVerdict`. Proving test: drainer test — watcher payload reaches the
   writer, row marked sent.

5. **[CW2] Revert detection.** Extend `corrections-watcher.ts` with a `This reverts commit <sha>`
   regex match against the same git-log scan; classify `amended` or `rejected` per §7's open
   question. Proving test: fixture repo with a revert commit → correct verdict.

6. **[CW2] Reopened-task detection (dispatch-coverage based, no external polling).** New
   `src/main/alicorn/reopened-task-detector.ts` — a new `dispatch_contexts` row on a task whose
   prior settled outcome was `succeeded` enqueues a `human_verdict_patch` on that prior outcome.
   Proving test: in-memory `OrchestrationDb` — two dispatches on one task, first succeeded, second
   created later → prior outcome flagged `amended`.

7. **[CW2/M2] `amended_within_window` metric.** New `ledger-api/src/ledger-metrics.ts` — query over
   `step_outcomes` for `human_verdict='amended' AND created_at > now() - interval`, exposed via
   `GET /v1/ledger/metrics` (or folded into task 9's report endpoint). Proving test: Postgres test —
   seed amended/non-amended outcomes at varying `created_at`, assert the count.

8. **[M1] `step_interruptions` table + gate/ask capture.** New table per §2 in `schema-sql.ts` +
   contract schema + `insertInterruption`. Desktop: read `decision_gates`/`questions` scoped to a
   task's active-dispatch window at settlement, enqueue one outbox row per interruption (new kind).
   Proving test: Postgres test — insert three interruption kinds, query back scoped by `dispatch_id`.

9. **[M1] `interruptions_per_completed_task` report endpoint.** New
   `ledger-api/src/interruptions-report.ts` — `getInterruptionsReport(pool, tenantId, {stageKey?,
   projectId?, memberId?}): Promise<{completedTasks, interruptions, perTask: number}>`; route
   `GET /v1/ledger/reports/interruptions`. Proving test: Postgres test with seeded data, assert the
   ratio for a scoped query.

10. **[M1] `alicorn ledger report` CLI + RPC plumbing.** New RPC method group (main) calling the
    Ledger API via `alicornFetch('ledger', ...)` (depends on B1's `alicornFetch` existing — flag as
    a second prerequisite if B1 isn't built either), new `src/cli/specs/ledger.ts` +
    `src/cli/handlers/ledger/report-handlers.ts` following `gate-handlers.ts`'s shape. Proving test:
    CLI spec test + handler test with a mocked `client.call`.

11. **[M2] Structured JSON request logging with `tenant_id`** in `control-api`/`ledger-api`
    (`app.ts` middleware; extend the relay's `console.log(JSON.stringify(...))` convention per §7
    rather than adopting OTel wholesale, unless the controller decides otherwise). Proving test:
    `app.test.ts` — a request through `requireTenant` produces one log line containing `tenant_id`.

12. **[M2] Metrics counters** (`gate_decisions{decision,reason}`, `ledger_write_duplicates`,
    `amended_within_window` from task 7; `relay_connections`/`postgres_replication_lag` are
    relay/infra-owned, out of scope) via a `/metrics` route on both services, same hand-rolled-
    counter style as `RelayObservability`. Proving test: a duplicate `step_outcomes` insert
    increments `ledger_write_duplicates`, visible on the metrics route.
