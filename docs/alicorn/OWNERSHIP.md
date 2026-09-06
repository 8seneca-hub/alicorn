# Ownership and boundaries

Two people build Alicorn in parallel. Ownership is by **Plane module** (project `ALC`,
https://projects.8seneca.com/8seneca/projects/2a53f690-4738-4491-b803-bbdf0a6e0cda/). Each module is a
vertical slice — the owner does its server *and* desktop side — so the two of us rarely edit the same
file. Where we must, the rule in *Shared files* applies. Task keys (`A5`, `C3`, …) are the ones in the
Plane issue titles and in `docs/alicorn/plans/`.

## Modules and code

| Module | Owner | Code the owner edits |
|---|---|---|
| Control plane platform | Huy | `cloud/packages/**`, `cloud/apps/control-api` skeleton + auth + policy/required-checks routes, `cloud/dev/**`, `.github/workflows/cloud-*`, `docs/alicorn/**` |
| Identity | Huy | Control API auth mode `keycloak` and identity tables; on the desktop only the body of `readAlicornBearer` (I4) |
| Ledger | Huy | `cloud/apps/ledger-api/**`; orchestration SQLite v31 (`db/schema/create-alicorn-tables-sql.ts`, `db/schema/migrate-v31-alicorn.ts`, `db/alicorn/**`), the C2 edit to `worker-report-settlement.ts` + `lifecycle-reconciliation.ts`; `src/main/alicorn/{ledger-outbox-drainer,step-outcome-builder,run-usage-attribution}.ts` |
| Quality gates & autonomy | Huy | `src/main/alicorn/diff-coverage/**`, gate policy + blast-radius budgets (server), stage keys |
| Cost & telemetry | Huy | `src/main/alicorn/run-cost-publisher.ts`, renderer run-cost store + sidebar chip, `getLastScanCompletedAt()` on the usage stores, OpenTelemetry in both services |
| Org platform & skills · Rebrand, cutover & distribution | Huy | as titled |
| Members | **Nghia** | `cloud/apps/control-api/src/members-*` from now on; `src/main/alicorn/{control-plane-urls,control-plane-session,control-plane-client,control-plane-client-instance,member-directory,worker-member-launch,review-backend-policy,author-backends,backend-from-start-options}.ts`; `src/main/ipc/alicorn-handlers.ts`; `src/preload/api/alicorn-*.ts`; `src/renderer/src/components/settings/AlicornMembersPane.tsx`, `alicorn-members-search.ts`, `settings-alicorn-section-renderers.tsx`; the `--member` / `--allow-same-backend-review` flags (D2, **D3**) |
| Execution strategy & Foreman | **Nghia** | `executionStrategy` on task RPC/CLI (D1); `src/main/alicorn/{context-ceiling-watcher,transcript-context-tail}.ts`; `EscalationOfferToaster.tsx`; `getRecentSessionTranscriptsForWorktree()` on `ClaudeUsageStore`; Foreman (v1.5) |
| Provenance & PR body | **Nghia** | `src/main/alicorn/{context-capture-enqueue,provenance-markdown}.ts`, the capture call sites in `orchestration-dispatch-methods.ts` / `orchestration-workers.ts`, the `hostedReview:create` edit in `src/main/ipc/hosted-review.ts`, provenance panel + export |
| Corrections watcher & Rulebook · Board automation & Plane provider · Workflows & stages · Interface · Multi-repo, contracts & mailbox | **Nghia** | as titled (later releases) |

`D3` (reviewer ≠ author backend) moved from *Quality gates* to *Members* because it lives inside the
`--member` launch path (`worker-member-launch.ts`); the pure policy and its wiring stay with one owner.

## Shared files — additive one-liners only, second to land rebases

`src/main/startup/main-process-runtime-service.ts`, `src/main/startup/main-process-state.ts`,
`src/main/ipc/register-core-handlers/register-core-handlers.ts`, `src/preload/index.ts`,
`src/preload/api-types.ts`, `src/main/runtime/rpc/methods/orchestration-schemas.ts`,
`orchestration-worker-start-schema.ts`, `src/cli/specs/*`, each cloud service's `src/app.ts`,
`cloud/pnpm-lock.yaml`, and the i18n catalogs (`src/renderer/src/i18n/locales/*.json` — never hand-edit;
run `node config/scripts/localize-renderer-strings.mjs && pnpm run sync:localization-catalog`).
The contract package (`cloud/packages/control-plane-contract`) is Huy's; propose field changes in the PR
description rather than editing it in a feature branch — the desktop mirrors its field names by hand.

## Seams we agree on (so neither side waits on the other)

- **SQLite v31 (C1, Huy) ships first**: tables `ledger_outbox`, `alicorn_task_strategy`,
  `alicorn_dispatch_members` and their `OrchestrationDb` methods (`enqueueLedgerOutbox`,
  `getTaskExecutionStrategy`/`setTaskExecutionStrategy`/`markEscalationOffered`,
  `setDispatchMember`/`getDispatchMember`). D1, D2, D4 consume them; do not add tables elsewhere.
- **Ledger writer interface (C3, Huy)**: the drainer depends on
  `{ postStepOutcome, patchStepOutcomeSpend, postStepVerification, postContextCapture }` with the contract
  package's field names; B2's `ControlPlaneClient` (Nghia) satisfies it structurally — no import from
  the drainer into Members code. Wiring the instance into the drainer is one line in
  `main-process-runtime-service.ts` (shared-file rule).
- **`window.api.alicorn` (B3, Nghia)** includes the two push events `onRunCostChanged` and
  `onEscalationOffer`; D7 (Huy) only subscribes and only sends `alicorn:runCost` from main.
- **Env names** (A9 compose, Huy — read by B1, Nghia): `ALICORN_CONTROL_API_URL`,
  `ALICORN_LEDGER_API_URL`, `ALICORN_TENANT_ID`, `ALICORN_LOCAL_API_TOKEN`.
- **Required checks (D5, Huy)** are fetched with B2's client directly (`getRequiredChecks(projectId)`),
  not through `member-directory.ts`.
- **`LOCAL-DEV.md`** is created by B1 (Nghia); E1 (Huy) appends the smoke checklist.

## Branches

Work from `main` (the branch that was `worktree-alicorn-tier-1`, now pushed as `main`). One
short-lived branch per Plane issue, named `alc-<n>-<slug>`, PR'd into `main`, rebased before merge.
Keep Plane in sync: move the issue to *In Progress* when you start and *Done* when the PR merges.
