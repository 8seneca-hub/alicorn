# Multi-repo, Contracts & Mailbox Implementation Plan (v2.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Caveat (v2.0):** depends on the Foreman plan (FM1 journal, FM2 `ForemanReportSchema.interface_delta`), the gates plan (required checks evaluation), and D4 (escalation watcher). The cross-backend mailbox is v2.0 by roadmap rule; single-backend hand-offs ship first. Re-verify anchors when picking a task up.

**Goal:** One task spanning repositories (repo/branch/worktree tuples resolved before dispatch), a **Contract Registry** holding typed interfaces between repos — agent-declared `interface_delta[]` first, OpenAPI/TS extraction where it exists — with a breaking-change flag that gates a PR until acknowledged and mocks generated from registered shapes, integration verification as a required check, and a backend-neutral mailbox whose messages survive host boundaries via the federation relay.

**Architecture:** Multi-repo is execution state in orchestration SQLite (`alicorn_task_worktrees`), with the coordinator resolving N worktrees (first = primary) and the lead's preamble listing all. The Contract Registry is a Control API subsystem (not the Ledger, never called "contract ledger"): rows are versioned per `(project, repo, kind, name)`, written by the coordinator after it processes a bounded report (idempotent on `(run_id, dispatch_id, name)`), and by an extractor for `openapi.json`/exported TS types when present. CR2 and IV1 are new required-check kinds evaluated by the existing check mechanism. The mailbox keeps today's handle-based addressing and gains a host-independent envelope id and delivery over the federation RPC channel (an additive RPC method — no new stream opcode), so MB2 reduces to advertising a `mailbox_v1` capability in the Subscribe handshake for discovery.

**Tech Stack:** orchestration SQLite (`create-alicorn-tables-sql.ts`, `coordinator-task-dispatch.ts`, `orchestration-folder-worktree-placement.ts`), Control API (hono/pg/zod), `ForemanReportSchema`, `orchestration-federation*.ts`, `RequiredCheckSchema`, `terminal-stream-protocol.ts` capabilities, vitest + `createOrchestrationRpcHarness`.

**Spec:** `docs/alicorn/PROJECT-BRIEF.md` §05 (Contract Registry, mailbox), §04; `CLAUDE.md` → _Naming: do not overload "ledger"_, _Wire changes are additive or capability-negotiated_, _The cross-agent mailbox is v2.0_; `docs/reference/remote-wire-compatibility.md`; research `research/interface-multirepo-mailbox.md`. Plane: MR1, CR1, CR2, IV1, MB1, MB2 (module _Multi-repo, contracts & mailbox_, owner Nghia).

## Global Constraints

- **"Contract Registry"**, never "contract ledger"; it lives in the Control API, has its own tables and is not append-only measurement data.
- **Wire changes are additive or capability-negotiated**: new RPC methods/optional fields are free; a new stream opcode requires the `Subscribe`/`subscribed` capability echo (precedent `SetOutputPaused`). `RUNTIME_PROTOCOL_VERSION` never bumps for additions.
- **Single-backend hand-off first**: MB1 ships with same-backend recipients; cross-backend routing reuses the same envelope with no new field.
- **A worktree belongs to one repo**; a task may bind many worktrees; the first tuple is primary (journal, PR body).
- Cross-platform paths (`path.join`); SSH and folder workspaces respected (a tuple's worktree may be remote; unreachable → `unverifiable`, never assumed dead); no `mode` fields; i18n by tooling; `tenant_id` + RLS on Control API tables; no AI attribution.

## Decisions

1. **Tuple type** `TaskWorktreeTuple = { repoId: string; branch: string; worktreeId: string; primary: boolean }`, stored in SQLite `alicorn_task_worktrees (task_id, repo_id, branch, worktree_id, is_primary, PRIMARY KEY (task_id, repo_id))`; `Worktree`/`Repo` types unchanged.

   **Amended as built (2026-09-08) — three changes, each forced by something the decision did not
   know.** `Worktree`/`Repo` are still unchanged, and the table is still task-keyed and additive.

   - **The primary key is `(task_id, worktree_id)`, not `(task_id, repo_id)`.** `folderWorkspaceToWorktree`
     gives every folder workspace in a project group the _same_ synthetic
     `repoId = folder-workspace:<projectGroupId>`, so a repo key silently collapses a two-folder
     feature workspace into one tuple. A worktree belongs to exactly one repo, so worktree identity
     is strictly finer and never wrong. `repo_id` stays a plain column; `duplicateGitRepoIds`
     detects two branches of one git repo for the picker, where that check actually belongs.
   - **`branch` is nullable.** A folder workspace has no branch (the projection writes `''`) and
     neither does a detached HEAD. Both are legal members of a feature workspace.
   - **The execution host is not stored.** A repo can be re-homed (local → SSH) under an
     already-bound task, so a cached host is a second source of truth that goes stale silently —
     and the failure is a client-side read of a remote path. `ResolvedTaskWorktreeTuple` adds
     `executionHostId`, `repoKind` and `path` at use time via
     `src/shared/alicorn/resolve-feature-workspace-tuples.ts`, which routes through the existing
     fail-closed resolvers (`resolveWorktreeExecutionHost`, `resolveFolderWorkspaceHost`) and
     returns an `unresolved` verdict rather than defaulting to `local`.

   **Cross-host feature workspaces are allowed** — a local frontend plus a backend on an SSH box is
   the shape that motivates the feature. Every operation over the set fans out per host
   (`groupTuplesByExecutionHost`), and a dispatched worker is handed paths only for the tuples on
   its own host (`partitionTuplesByReachability`); the rest are named as off-host. That partition is
   by ownership, never liveness — `unverifiable` stays a separate verdict.

   **`SCHEMA_VERSION` 39 is claimed by this table** (v38 was taken by the gate-policy work).

2. **Registry write path**: coordinator → Control API directly (not via `ledger_outbox`; the outbox is Ledger-only by CLAUDE.md), idempotent on `(tenant_id, project_id, run_id, dispatch_id, name)`.
3. **Extraction sources** in order: `openapi.json` at repo root or `docs/` (JSON only; YAML needs a parser the repo does not ship), exported TS types under a configured `contracts/` directory via the TypeScript compiler API already in the toolchain; everything else agent-declared.
4. **CR2 gate** = required check `{ kind: 'contract_acknowledged' }`: fails when any contract row for the run has `breaking = true` and `acknowledged_by IS NULL`; acknowledgement is a human action (`POST …/acknowledge`).
5. **Mocks** are generated for `http_endpoint` and `type` contracts whose `shape` is a JSON Schema: `generateMock(schema)` produces one example value per property (strings from `format`, numbers from bounds, enums first value) — deterministic, no dependency.
6. **IV1** = required check `{ kind: 'integration_verify', command, repoId }`: runs `command` in the named repo's worktree with the other tuples' worktree paths in env (`ALICORN_WORKTREE_<REPO>`), passes on exit 0.
7. **Mailbox envelope** `{ envelopeId: uuid, originHostId, runId, message: MessageRow }`; delivery RPC `orchestration.mailDeliver { envelope }` over the federation relay; ack RPC `orchestration.mailAck { envelopeId }`; the receiving host inserts with `delivery_contract = 'current_delivery'` and the local `deliveries` row keyed by `envelopeId` in `message_ids`. No new opcode (MB2 = capability advertisement only).

## Tasks

### Task 1 (MR1a): tuple storage and resolution

`create-alicorn-tables-sql.ts` (+ `alicorn_task_worktrees`), migration (`SCHEMA_VERSION` +1), `db/alicorn/task-worktree-methods.ts` (`setTaskWorktrees`, `listTaskWorktrees`), RPC `orchestration.taskWorktreesSet { taskId, tuples }`, `orchestration-folder-worktree-placement.ts` (`assertOrchestrationWorktreeCreationSupported` accepts an array; validates each `repoSelector`), `coordinator-task-dispatch.ts` (resolves all tuples before dispatch; primary → the existing scalar `worktree`; all paths into the dispatch env `ALICORN_WORKTREE_<REPO_SLUG>` and the preamble _Repositories_ section). Tests (harness): two tuples → two worktrees resolved, primary chosen, env populated; one tuple → identical to today.

- [x] **Partly landed 2026-09-08 (ALC-83).** Shipped: the tuple model and its normalization
      (`src/shared/alicorn/feature-workspace-tuples.ts`), host resolution
      (`resolve-feature-workspace-tuples.ts`), the table + v39 migration
      (`create-alicorn-tables-sql.ts`, `migrate-v39-task-worktrees.ts`), the store
      (`db/alicorn/task-worktree-methods.ts` — `setTaskWorktrees` / `listTaskWorktrees` /
      `countTaskRepos`, whole-set replace in one transaction) and the additive RPC pair
      `orchestration.taskWorktreesSet` / `orchestration.taskWorktreesList`. 42 tests.
      **Not done, and deliberately deferred:** `coordinator-task-dispatch.ts` still resolves the one
      scalar worktree it always did — nothing reads the tuples on the dispatch path yet, so the
      `ALICORN_WORKTREE_<REPO_SLUG>` env export and the preamble _Repositories_ section are unbuilt,
      and so is `assertOrchestrationWorktreeCreationSupported` taking an array. Wiring those touches
      the live dispatch path and wants its own ticket. MR2 needs only `countTaskRepos`, which is
      done.

### Task 2 (MR1b): composer multi-repo picker

Near `ComposerParentWorktreePicker.tsx`: `ComposerRepoTuplesPicker.tsx` (add repos, choose branch per repo, primary radio), wired into new-workspace/new-task creation → `taskWorktreesSet`. Cross-repo tasks show a "spans N repos" badge in the tab bar; D4's watcher reads `listTaskWorktrees(taskId).length > 1` for the escalation offer (the Foreman plan's MR2 task consumes this). Component tests. Localise.

- [ ] Commit `feat(alicorn): pick several repositories for one task`.

### Task 3 (CR1a): Contract Registry — schema, routes, agent-declared ingest

Control API `contracts (id, tenant_id, project_id, repo_id, kind CHECK IN ('http_endpoint','type','event','schema','cli'), name, shape JSONB, breaking BOOLEAN, version INTEGER, source CHECK IN ('declared','openapi','types'), run_id, dispatch_id, acknowledged_by, acknowledged_at, created_at, UNIQUE (tenant_id, project_id, run_id, dispatch_id, name))` + RLS; contract `contract-registry.ts` (`ContractSchema`, `ContractDeltaInputSchema` = `ForemanReportSchema.shape.interface_delta.element` + `repoId`); routes `POST /v1/projects/:projectId/contracts/deltas` (bulk, idempotent), `GET /v1/projects/:projectId/contracts?repoId&name`, `POST /v1/contracts/:id/acknowledge`. Desktop: `coordinator-foreman-journal.ts` sibling `coordinator-contract-registry.ts` posts `interface_delta[]` after each `worker_done` (Decision 2; failures logged and retried on the next report — never block settlement). Tests: route + RLS; coordinator posts once per dispatch.

- [ ] Commit `feat(alicorn): Contract Registry — agent-declared interface deltas`.

### Task 4 (CR1b): extraction from OpenAPI and TS types

`src/main/alicorn/contracts/extract-openapi.ts` (reads `openapi.json`; each path+method → `http_endpoint` with the operation's request/response JSON Schema as `shape`), `extract-ts-types.ts` (TypeScript compiler API over `contracts/**/*.ts` exported types → `type` contracts with a JSON-Schema-like shape via a small emitter for primitives/objects/arrays/unions of literals), `contract-extraction.ts` (`extractContracts(worktreePath) → ContractDeltaInput[]`, diffed against the registry to set `breaking` = removed property/endpoint or narrowed type). Runs at task creation and at PR time. Tests with fixture repos.

- [ ] Commit `feat(alicorn): contract extraction from OpenAPI and exported TypeScript types`.

### Task 5 (CR2): breaking-change gate and mocks

`RequiredCheckSchema` variant `{ kind: 'contract_acknowledged' }`; check evaluator (`src/main/alicorn/checks/contract-acknowledged-check.ts`) per Decision 4; `src/main/alicorn/contracts/generate-mock.ts` (Decision 5) + CLI `alicorn contracts mock <name> [--out file]`; PR body (D6, Nghia) gains a _Contracts_ section listing breaking deltas and acknowledgements (additive). Tests: unacknowledged breaking → check fails; acknowledged → passes; mock generation for a fixture schema.

- [x] **Landed 2026-09-09 (CR2).** Shipped: the `contract_acknowledged` variant on
      `RequiredCheckSchema` (and its desktop mirror in `shared/alicorn/members.ts`), the evaluator
      (`src/main/alicorn/contracts/contract-acknowledged-check.ts`) run by the existing
      `createVerificationRunner`, which now walks every authored check rather than only
      `diff_coverage`; `generate-mock.ts` plus `openapi-mock-lookup.ts` / `mock-from-worktree.ts`
      and the local CLI `orca contracts mock <name> [--out <file>]`.

      **Three deviations from Decision 4/5, each forced by what CR1 actually built.**

              - **There is no `contracts` table, so the gate reads the journal.** CR1 put the Contract
                Registry in the Feature Journal on disk (`foreman/contract-registry.ts`), not in the Control
                API. Building a Postgres registry now would be the parallel store CR1 already replaced, so
                the check reads `journal.contractRegistry.entries` for the run instead of `contract` rows.
              - **Only the *acknowledgement* is server-side** — `contract_acknowledgements
                (tenant_id, project_id, run_id, contract_name, acknowledged_by, acknowledged_at)`, RLS
                forced, with `POST /v1/projects/:projectId/contracts/acknowledge` and
                `GET …/contracts/acknowledgements?runId=`. That split is the invariant, not a compromise: the
                journal is writable by the run that broke the contract, so an acknowledgement kept there is
                one a member could grant itself. Acknowledgement is keyed on the contract *name*; the failure
                detail is repo-qualified so a human knows where to look. First writer wins — a re-post must
                not reassign who accepted the break.
              - **Mocks resolve back to the OpenAPI document, not to the registry row.** A registry `shape`
                is a clamped ~200-token *description*, never a JSON Schema, so `generateMock(schema)` has no
                input there. `orca contracts mock` finds the named component schema or operation in the
                worktree's own OpenAPI documents and mocks that. TypeScript-extracted contracts are not
                mockable and say so. The command is local — no RPC, no token — so it works in a worker's
                terminal.

              **Not done:** the PR body's *Contracts* section. A failing `contract_acknowledged` check
              already renders in the PR body's **Checks** list via `renderProvenanceMarkdown`; listing each
              breaking delta by name would mean widening `ProvenanceView.checks` across the desktop and its
              canonical cloud copy (and the parity test between them) for a cosmetic gain. Its own ticket.

### Task 6 (IV1): integration verify as a required check

`RequiredCheckSchema` variant `{ kind: 'integration_verify', command: z.string().min(1).max(500), repoId: z.string() }`; evaluator `integration-verify-check.ts` (Decision 6; runs through `runProcess`, never `child_process`; SSH worktrees via the provider's exec; folder workspaces allowed if the command is set; timeout 15 min → `unverifiable` with reason). Tests: passing/failing fixture commands; env carries the other tuples' paths.

- [x] **Landed 2026-09-09 (IV1).** Shipped: the `integration_verify` variant on
      `RequiredCheckSchema` (and its desktop mirror in `shared/alicorn/members.ts`), the evaluator
      (`src/main/alicorn/integration-verify/integration-verify-check.ts`) run by the existing
      `createVerificationRunner`, and the use-time workspace resolution beside it
      (`task-feature-workspaces.ts`).

      **Three things Decision 6 did not say, each decided by what MR1 built.**

              - **`repoId` resolves against the task's tuples, and a task with none still works.** The
                pre-MR1 shape — no bound tuples — resolves to the dispatch's own worktree, so the check is
                usable on a single-repo project today rather than waiting on the composer picker (MR1b).
                Paths are exported for every same-host tuple including the target's own, one rule for all;
                off-host and host-unresolved tuples are named in the detail instead.
              - **The verdict vocabulary is three-valued, and `skipped` is the unknown bucket.** A command
                that ran and exited non-zero is `failed`. An unreachable execution host, a timeout, a
                host that would not resolve, and a `repoId` the task never bound are all `skipped` with a
                reason — `resolveRequiredChecksPassed` reads that as unknown-not-a-pass, which is the
                fail-closed answer. `error` stays for plumbing (spawn failure, an exit code the transport
                lost). There is no `unverifiable` status to record: the ledger's enum is
                passed/failed/skipped/error, and widening it is a wire change this did not need.
              - **The remote ceiling is five minutes, not fifteen.** `agent.execNonInteractive` clamps to
                `MAX_TIMEOUT_MS` on the relay (`src/relay/agent-exec-handler.ts`), so an SSH check longer
                than that comes back `timedOut` — recorded honestly as `skipped` with the reason, never as
                a pass. Raising it is a relay change with its own wire-compatibility story.

              **One fix pulled in, because IV1 makes the bug reachable.** IV1 is the first kind a project
              can author more than once (one per repo), and `resolveRequiredChecksPassed` matched a
              recorded row by `kind` alone and took the latest — so one repo's pass could answer for
              another repo's failure. Rows are now matched on kind *and* name, with
              `shared/alicorn/required-check-name.ts` as the single place a check's row name is spelled.
              That also stops a re-thresholded `diff_coverage` reusing its old verdict.

              **Not done:** authoring UI for the new variant (the Control API route stores it; there is no
              composer surface yet), and `assertOrchestrationWorktreeCreationSupported`/the dispatch
              preamble, which are still MR1a's deferred half.

### Task 7 (MB1a): mailbox envelope with a durable id

`orchestration/types.ts` (`MessageRow.envelope_id?: string`, `origin_host_id?: string`), `create-core-tables-sql.ts` (`ALTER TABLE messages ADD COLUMN envelope_id TEXT` / `origin_host_id TEXT` in a versioned migration; unique index on `envelope_id` where not null), `db/messages/message-insert.ts` (generate `envelope_id` when absent; ignore duplicates by `envelope_id`). Test: inserting the same envelope twice yields one row.

- [ ] Commit `feat(orchestration): mailbox messages carry a host-independent envelope id`.

### Task 8 (MB1b): cross-host delivery over the federation relay

RPC methods `orchestration.mailDeliver` / `orchestration.mailAck` (Decision 7) in `orchestration-federation-mail.ts`; sender side: when `resolveBareOrchestrationRecipient` resolves to a dispatch attached on another host (federation attach record), `orchestration.send` forwards the envelope over the relay channel instead of local insert, marking the local row `delivery_contract = 'audit_only'`; receiver inserts + creates `deliveries` row; ack flows back. Tests: two harness instances exchange a message by envelope id; duplicate delivery is idempotent; relay unreachable → message stays queued with a warning, never dropped.

- [ ] Commit `feat(orchestration): cross-host mailbox delivery over the federation relay`.

### Task 9 (MB2): capability advertisement

`terminal-stream-protocol.ts` / Subscribe handshake: client advertises `mailbox_v1` in `capabilities`; host echoes on `subscribed`; the sender in Task 8 forwards only after the echo (older hosts → local `legacy_terminal_recipient` warning as today). No new opcode (Decision 7). Tests: extend `cross-version-terminal-wire.unit.test.ts` — negotiated vs un-negotiated; derive the old side's capability list from its own source, never hard-code it.

- [ ] Commit `feat(orchestration): mailbox_v1 capability negotiation`.

### Task 10: docs — `docs/alicorn/ARCHITECTURE.md` (Contract Registry tables, mailbox envelope), `docs/reference/remote-wire-compatibility.md` (mailbox_v1 as a negotiated capability example), `CLAUDE.md` (multi-repo tuples; registry naming). Commit `docs(alicorn): multi-repo, Contract Registry and mailbox as built`.

## Self-review

MR1 (1, 2), CR1 (3, 4), CR2 (5), IV1 (6), MB1 (7, 8), MB2 (9). Constraints: registry naming and location (3); additive wire (7–9; no opcode); single-backend first (8 routes by handle, backend-agnostic); one repo per worktree (1); SSH/folder handling (1, 6); no outbox misuse (Decision 2). Types: `TaskWorktreeTuple` (1) used by 2, 6; `ContractDeltaInputSchema` (3) by 4, 5; envelope (7) by 8, 9. Order 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10; needs on `main`: FM1/FM2, gates plan check evaluation, D4, D6.
