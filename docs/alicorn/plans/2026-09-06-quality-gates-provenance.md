# Quality Gates, Autonomy Levels 0–2 & Provenance Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "done" into machine-checkable gates with evidence: `evaluateGate` inside `orchestration.gateCreate { evaluate }` following ARCHITECTURE §7's fixed order; autonomy policy as data with an author and an expiry; evidence (windowed track record) from the ledger; blast-radius budgets per run; a level-1 advisory pre-fill in a real gate UI; and the provenance panel + signed export that explain _why no human was asked_.

**Architecture:** Policy is product configuration and lives in the Control API (`autonomy_policies`, `project_stage_config`, `project_protected_paths`, all admin-authored per project — tier 1 has no stages). Evidence is derived from the append-only ledger and lives in the Ledger API (`GET /v1/ledger/evidence` computes **windowed** stats over the last 50 outcomes; `member_stage_stats.level` is maintained by the Ledger API on every write). `evaluateGate` is a pure function in main; `gateCreate` assembles step/policy/evidence (with short-TTL caches, failing _safe_ to a gate when anything is missing) and, on `auto`, resolves the gate itself so a caller can never ask the policy and ignore it. Level 0 always gates but records the decision it would have made on the enqueued outcome. The provenance panel joins `ProvenanceReport` + `evidence` client-side; the export is signed server-side.

**Tech Stack:** main-process RPC (`defineMethod`, `createOrchestrationRpcHarness`), orchestration SQLite (`decision_gates` stays client-side per ARCHITECTURE), Control API + Ledger API (hono/pg/zod, Postgres route tests), renderer right-sidebar panel patterns (`right-sidebar/checks-panel`, `CheckDetailsPanel`, `MetadataStatusBadge`), `node:crypto` HMAC.

**Spec:** `docs/alicorn/ARCHITECTURE.md` §6–§9; `docs/alicorn/ROADMAP.md` v1.0 (Gate policy, Blast-radius budgets, Provenance panel; exit criteria); `docs/alicorn/PROJECT-BRIEF.md` §03 (Autonomy), §06.1, §09; `CLAUDE.md` invariants (_Hard stops never retire_, _A member cannot loosen its own criteria_, _Guard rails ship with the feature_); research `research/quality-gates-provenance.md`. Plane: GP1–GP3, BR1 (module _Quality gates & autonomy_, owner Huy); PV1, PV2 (module _Provenance & PR body_, owner Nghia).

## Global Constraints

- **Evaluation order is fixed** (ARCHITECTURE §7): `always_gate → irreversible → inherited → unverified → blast:files → blast:spend → blast:reach → history → accept-rate → regression → auto`. Hard stops first; no accumulated evidence retires them.
- **`reversibility` and `inherited_cost` are authored, never inferred**; tier 1 authors them per project + stage key (`project_stage_config`), with `merge` and `deploy` seeded `irreversible`.
- **Evaluation lives only inside `gateCreate { evaluate: true }`** — no separate "should I gate?" RPC. `orchestration.evidence` returns track record + _what the policy would decide now_ for display, and is not consulted by callers to skip a gate.
- **Level 0 always gates** and records `gate_decision`/`gate_reason`/`gate_id` on the outcome. **Levels 2–3 are not enabled by this plan** unless the corrections watcher (ledger-completion plan) is on `main` — `computeLevel` caps at 1 when `amendments_observed = false` (a config flag the Ledger API derives from the existence of any `human_verdict` write).
- **Windows are the last 50 runs, not lifetime.** Evidence queries the last 50 outcomes per (member, stage, project); `member_stage_stats` remains a cache for `level` and lifetime counts.
- **`never_gate` requires `created_by` and `expires_at`** (zod refine + DB CHECK) and appears in the audit view until it lapses.
- **Blast-radius budgets are per run**: files/spend sum across all dispatches of the run.
- **Missing evidence fails safe**: unreachable Control/Ledger API, unknown files (SSH unreachable/folder workspace), or unknown spend → the corresponding gate reason (`unverified`, `history`, `blast:reach` cannot be evaluated → `unverified`), never `auto`.
- Additive wire changes; `tenant_id` + forced RLS on new tables; i18n by tooling; no AI attribution in commits.
- **`member_stage_stats.accept_rate` remains machine-derived** — it counts the outcome the agent
  reported. Demotion is evaluated from `step_outcomes.human_verdict` (written by the corrections
  sweep), never from `accept_rate`.

## Decisions made in this plan

1. **Windowed evidence by query, level as a cached column.** `getEvidence` computes `{ runs, accepted, rejected, amended, acceptRate, recentRegression }` over the latest 50 outcomes; `computeLevel(stats, policy, amendmentsObserved)` (pure, ARCHITECTURE §7 table + demotion rule "one rejected, or two amended within the last ten runs") runs on every outcome insert and verdict patch and writes `member_stage_stats.level`.
2. **Per-project stage config table** `project_stage_config (tenant_id, project_id, stage_key, reversibility, inherited_cost)`; defaults when no row: `contained`/`low`, except `merge`/`deploy` → `irreversible`/`high`. Becomes `stages.*` when workflows land (WF1).
3. **Protected paths** as glob patterns (`**`, `*`, `?` only) matched by an in-house 30-line matcher — no new dependency.
4. **Files-changed for blast radius are computed honestly** from the worktree (`git diff --name-only <baseRef>...HEAD` ∪ `git status --porcelain` paths) at gate time; self-reported `files_modified` is never used for budgets. SSH worktrees run git on the host via the provider; unreachable/folder → unknown.
5. **Spend-so-far** comes from D7's run-cost publisher (`known` estimates only); unknown → excluded and reported as `spendKnown: false` in the gate record.
6. **Evidence and policy are cached in main for 60 s** (same shape as `member-directory.ts`); a cache miss with the control plane unreachable → fail safe.
7. **Advisory agreement (GP3)** is recorded on the interruption row: `step_interruptions.recommendation`, `agreed` (additive columns on the table the ledger-completion plan introduces; if that plan has not landed, GP3 adds the table's minimal form itself and the two plans reconcile at review).
8. ~~**PV2 export signature = HMAC-SHA256** over canonical JSON with `ALICORN_EXPORT_SIGNING_SECRET` (service signature). Asymmetric signing is a follow-up if auditors need non-repudiation.~~
   **Superseded as built (2026-09-08): ES256, not HMAC.** An HMAC an auditor can only check by holding the secret that produced it is not evidence — the same key both signs and verifies, so the exporter can never be told apart from a forger, and handing the secret out lets anyone mint exports. The estate already speaks ES256 against a JWKS (the relay's token verifier pins `algorithms: ['ES256']`), so PV2 signs with an EC P-256 key from `ALICORN_LEDGER_EXPORT_SIGNING_KEY_PEM` and publishes the public half at `GET /.well-known/alicorn-provenance-jwks.json`. When I5 mints relay tokens and publishes JWKS, this consumes that keyring rather than keeping its own; the seam is `readProvenanceExportSigningKey` + `deps.exportSigningKey`, and nothing else in the export path knows where the key came from.
9. **Gate UI is greenfield** (no renderer reads gates today): a `right-sidebar/gate-panel/` following `checks-panel`, with the provenance panel as a second tab of the same surface.

## File structure

```
cloud/packages/control-plane-contract/src/autonomy-policy.ts      AutonomyPolicySchema (+ never_gate refine), StageConfigSchema, ProtectedPathsSchema, EvidenceSchema, GateEvaluationSchema
cloud/apps/control-api/src/{autonomy-policy,stage-config,protected-paths}-{repository,routes}.ts + schema-sql.ts additions
cloud/apps/ledger-api/src/evidence-repository.ts                   getEvidence (windowed), computeLevel, applyLevel
cloud/apps/ledger-api/src/step-outcomes-repository.ts              gate fields settable; level recompute hook
cloud/apps/ledger-api/src/provenance-export.ts                      signed export (json|md)
src/main/alicorn/gates/evaluate-gate.ts                            pure evaluateGate(step, policy, evidence) + computeLevel mirror for display
src/main/alicorn/gates/gate-evidence-cache.ts                       60 s cache over B2 client reads
src/main/alicorn/gates/blast-radius.ts                             filesChanged(), matchProtectedPaths(), assembleBlastRadius()
src/main/alicorn/gates/glob-match.ts
src/main/runtime/rpc/methods/orchestration-gates.ts                 gateCreate { evaluate }, policySet/policyGet/evidence RPCs
src/preload/api/alicorn-gates-*.ts, src/main/ipc/alicorn-gates-handlers.ts
src/renderer/src/components/right-sidebar/gate-panel/**            GatePanel (pending gate, recommendation, resolve), ProvenancePanel tab
src/renderer/src/components/right-sidebar/gate-panel/compose-provenance-view.ts
src/main/ipc/export.ts                                              + export:save-text
```

---

### Task 1 (GP1a): `evaluateGate` pure function

**Files:** `src/main/alicorn/gates/evaluate-gate.ts` + test; contract `autonomy-policy.ts` (types shared with the services).

```ts
export type GateStep = {
  stageKey: string
  reversibility: 'free' | 'contained' | 'irreversible'
  inheritedCost: 'low' | 'high'
}
export type AutonomyPolicy = {
  mode: 'always_gate' | 'evidence' | 'never_gate'
  minRuns: number
  minAcceptRate: number
  maxFiles: number | null
  maxSpendCents: number | null
  createdBy: string
  expiresAt: string | null
}
export type GateEvidence = {
  allRequiredChecksPassed: boolean | null
  filesChanged: number | null
  spendCents: number | null
  touchedProtectedPath: boolean | null
  stats: { runs: number; acceptRate: number; recentRegression: boolean } | null
}
export type GateDecision = {
  decision: 'gate' | 'auto'
  reason:
    | 'policy'
    | 'irreversible'
    | 'inherited'
    | 'unverified'
    | 'blast:files'
    | 'blast:spend'
    | 'blast:reach'
    | 'history'
    | 'accept-rate'
    | 'regression'
    | 'auto'
    | 'never_gate'
}
export function evaluateGate(
  step: GateStep,
  policy: AutonomyPolicy,
  evidence: GateEvidence
): GateDecision
// order exactly as Global Constraints; null evidence → the corresponding gate reason ('unverified' for checks/protected-path unknown, 'history' for stats unknown); never_gate (unexpired) → { auto, 'never_gate' } only after the two hard stops; expired never_gate → treated as 'evidence'
```

- [ ] Failing tests: one per branch in order; hard stop wins over a would-be `auto`; null evidence fails safe; expired `never_gate`. Commit `feat(alicorn): evaluateGate — ARCHITECTURE §7 policy order as a pure function`.

---

### Task 2 (GP1b/BR1b): Policy, stage config and protected paths in the Control API

**Files:** contract `autonomy-policy.ts` (`AutonomyPolicySchema` with `.refine(p => p.mode !== 'never_gate' || (p.createdBy && p.expiresAt), 'never_gate requires an author and an expiry')`, `StageConfigSchema`, `ProtectedPathsSchema = z.object({ patterns: z.array(z.string().min(1)).max(200) })`); control-api schema:

```sql
CREATE TABLE IF NOT EXISTS autonomy_policies (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, stage_key TEXT NOT NULL DEFAULT 'build', member_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('always_gate','evidence','never_gate')), min_runs INTEGER NOT NULL DEFAULT 10, min_accept_rate NUMERIC(5,4) NOT NULL DEFAULT 0.9,
  max_files INTEGER, max_spend_cents INTEGER, created_by TEXT NOT NULL, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode <> 'never_gate' OR expires_at IS NOT NULL), UNIQUE (tenant_id, project_id, stage_key, member_id));
CREATE TABLE IF NOT EXISTS project_stage_config (tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, stage_key TEXT NOT NULL, reversibility TEXT NOT NULL CHECK (reversibility IN ('free','contained','irreversible')), inherited_cost TEXT NOT NULL CHECK (inherited_cost IN ('low','high')), updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, project_id, stage_key));
CREATE TABLE IF NOT EXISTS project_protected_paths (tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, patterns JSONB NOT NULL DEFAULT '[]'::jsonb, updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, project_id));
```

- `tenantRlsPolicySql` for each. Routes (admin = the caller in local mode; role check arrives with Identity/OP1): `GET/PUT /v1/projects/:projectId/autonomy-policy?stageKey&memberId`, `GET /v1/projects/:projectId/autonomy-policies` (list, incl. active `never_gate` exceptions for the audit view), `GET/PUT /v1/projects/:projectId/stage-config/:stageKey` (defaults when absent: `merge`/`deploy` → `irreversible`/`high`, else `contained`/`low`), `GET/PUT /v1/projects/:projectId/protected-paths`.

* [ ] Postgres route tests mirroring `policy-routes-postgres.test.ts`: refine rejects `never_gate` without expiry (400); upsert/list; stage defaults; RLS. Commit `feat(control-api): autonomy policies, per-project stage config, protected paths`.

---

### Task 3 (GP2 server): Evidence + levels in the Ledger API

**Files:** contract (`EvidenceSchema`, gate fields on `StepOutcomeInputSchema`: `gateDecision?: string`, `gateReason?: string`, `gateId?: string` — all optional, additive), ledger-api `evidence-repository.ts`, `step-outcomes-repository.ts` (write gate fields; call `applyLevel` after insert and after a verdict patch), `ledger-routes.ts` (`GET /v1/ledger/evidence?memberId&stageKey&projectId`), tests.

```ts
export type WindowedStats = {
  runs: number
  accepted: number
  rejected: number
  amended: number
  acceptRate: number
  recentRegression: boolean
  lastAmendedAt: string | null
  level: number
  amendmentsObserved: boolean
}
export function getEvidence(
  pool,
  tenantId,
  key: { memberId; stageKey; projectId }
): Promise<WindowedStats>
// SELECT outcome, human_verdict FROM step_outcomes WHERE member_id=$1 AND stage_key=$2 AND project_id=$3 ORDER BY created_at DESC LIMIT 50
// accepted = outcome='succeeded' AND human_verdict IS DISTINCT FROM 'rejected'/'amended'; recentRegression = any rejected in last 10 OR ≥2 amended in last 10
export function computeLevel(
  stats: WindowedStats,
  thresholds: { minRuns: number; minAcceptRate: number }
): 0 | 1 | 2 | 3
// 0 default; 1 if runs ≥ 10; 2 if runs ≥ 20 && acceptRate ≥ 0.90; 3 if runs ≥ 50 && acceptRate ≥ 0.95 && no amended in last 20; demote one level on recentRegression; cap at 1 while !amendmentsObserved
export async function applyLevel(client, tenantId, key): Promise<number> // recompute + UPDATE member_stage_stats.level
```

- [ ] Postgres tests: window ignores the 51st outcome; regression demotes; cap at 1 without amendments; gate fields persisted and returned in provenance. Commit `feat(ledger-api): windowed evidence, autonomy level maintenance, gate fields on outcomes`.

---

### Task 4 (GP2 main): `policySet` / `policyGet` / `evidence` RPCs + caches

**Files:** `src/main/alicorn/gates/gate-evidence-cache.ts` (60 s TTL over B2's client: `getAutonomyPolicy`, `getStageConfig`, `getProtectedPaths`, `getEvidence` — add these reads to B2's client interface (Nghia's file — coordinate; alternatively call `alicornFetch` directly here — chosen: direct `alicornFetch`, own file, no B2 edit), `src/main/runtime/rpc/methods/orchestration-gates.ts` (+ `orchestration.policySet`, `orchestration.policyGet`, `orchestration.evidence` → `{ stats, wouldDecide: GateDecision }` computed with `evaluateGate` using the current policy and an evidence object built from stats only), CLI specs `policy-set`/`policy-get`/`evidence`.

- [ ] RPC harness tests with a stubbed fetch; `never_gate` without expiry rejected before any write. Commit `feat(alicorn): autonomy policy and evidence RPCs with short-TTL caches`.

---

### Task 5 (BR1a): Blast-radius evidence

**Files:** `src/main/alicorn/gates/glob-match.ts` (+ test), `blast-radius.ts` (+ test with a fake git exec and a fake run-cost store).

```ts
export function globToRegExp(pattern: string): RegExp // ** any depth, * within segment, ? one char; anchored
export async function filesChangedInWorktree(input: {
  worktreePath: string
  baseRef: string
  exec: (argv: string[]) => Promise<{ stdout: string }>
}): Promise<string[] | null> // diff --name-only base...HEAD ∪ status --porcelain paths; null on error
export function assembleBlastRadius(input: {
  runDispatchFiles: string[][]
  protectedPatterns: string[]
  spendCentsByDispatch: Array<number | null>
}): {
  filesChanged: number
  touchedProtectedPath: boolean
  spendCents: number | null
  spendKnown: boolean
}
// per run: union of files across dispatches; spend = sum of known, spendKnown = every dispatch known
```

- [ ] Tests: glob cases; union across dispatches; protected match; spend unknown propagates. Commit `feat(alicorn): blast-radius evidence — honest files changed, protected paths, run spend`.

---

### Task 6 (GP1c): `gateCreate { evaluate }`

**Files:** `orchestration-gates.ts` (`GateCreateParams.evaluate: OptionalBoolean`, `stageKey: OptionalString` default `'build'`), `src/main/alicorn/gates/gate-evaluation.ts` (assembles step/policy/evidence: member from `getDispatchMember`, stage config, policy for (project, stage, member ?? any), evidence from cache, required checks from the local verification record written by D5 before enqueue (`alicorn_dispatch_verifications` table — add in this task, SQLite v3x — written by the drainer's `step_verification` branch), blast radius from Task 5 over the run's dispatches), `decision-gate-store.ts` (+ `resolveGateAuto(id, reason)` and a `recommendation` column), `step-outcome-builder.ts` (C3, Huy) reads the gate record to fill `gateDecision`/`gateReason`/`gateId`.
Flow: `createGate` → if `evaluate`: `decision = evaluateGate(...)`; level ≥ 2 and `decision.decision === 'auto'` → `resolveGateAuto(id, 'auto:<reason>')`, task unblocked, return `{ gate, resolution: 'auto:<reason>' }`; else store `recommendation = decision` on the gate (level 1 pre-fill) and return pending; level 0 → pending, decision recorded only. Every path records the would-be decision for the outcome.

- [ ] Harness tests: level-0 policy → pending with `recommendation`; level-2 + all evidence → auto-resolved; missing evidence → pending `unverified`; `evaluate` absent → old behaviour. Commit `feat(alicorn): gateCreate evaluates the autonomy policy; auto-resolves only at level 2+`.

---

### Task 7 (GP3): Gate panel with advisory pre-fill

**Files:** IPC `alicorn-gates-handlers.ts` (`alicorn:gates:list`, `alicorn:gates:resolve`, `alicorn:gates:evidence`), preload `alicorn-gates-api.ts`/`-bridge.ts` (Huy-owned files; distinct from Nghia's `alicorn-*` Members bridge — names are explicit), renderer `right-sidebar/gate-panel/GatePanel.tsx` (pending gates for the active worktree: question, options, recommendation badge `MetadataStatusBadge` with the reason, resolve buttons pre-selecting the recommendation), `use-gate-panel-state.ts`; on resolve: `gateResolve` + enqueue interruption `agreed = (resolution === recommendation)` (via the interruption capture module; if absent, record on the local gate row for the capture to pick up).

- [ ] Component tests (happy-dom idiom): recommendation rendered and pre-selected; resolving calls the bridge with the payload; no gates → empty state. Localise. Commit `feat(alicorn): gate panel — level-1 advisory recommendation and agreement recording`.

---

### Task 8 (PV1): Provenance panel

**Files:** `compose-provenance-view.ts` (pure: `ProvenanceReport` + per-outcome `evidence` + stage config → view-model rows: checks, reversibility/inherited cost, blast radius (current run), track record, policy applied, "why no human was asked" text when `gateDecision` starts with `auto:`), `ProvenancePanel.tsx` (second tab in the gate panel surface; sections modelled on `CheckDetailsPanel`), IPC `alicorn:provenance:get` (main → `alicornFetch('ledger', provenance)` + evidence per member/stage).

- [ ] Tests: composer with fixtures (auto-resolved vs gated); component renders each section. Localise. Commit `feat(alicorn): provenance panel — why no human was asked`.

---

### Task 9 (PV2): Signed export

**Files:** ledger-api `config.ts` (`ALICORN_EXPORT_SIGNING_SECRET` ≥ 32 chars, optional; 503 `export_not_configured` when absent), `provenance-export.ts` (`GET /v1/ledger/provenance/export?repoId&branch&format=json|md` → `{ format, payload, signedAt, signature: hex HMAC-SHA256 over canonicalJson({ payload, signedAt }) }`; Markdown via `renderProvenanceMarkdown` (D6) extended with gate/evidence sections), `verifyExportSignature(secret, body)` exported for tests; desktop `src/main/ipc/export.ts` (+ `export:save-text` — save dialog + `writeFile`), preload `export-bridge.ts` (+ `saveText`), panel "Export" button (JSON/Markdown).

- [x] **Server half as built (2026-09-08).** Route and 503 code are as planned; the envelope and the signature are not (see Decision 8). Shipped:
  - `cloud/packages/control-plane-contract/src/canonical-json.ts` — RFC 8785 (JCS), so a document that survives a store and a re-serialisation still verifies.
  - `.../provenance-view.ts` + `.../provenance-markdown.ts` — the **canonical** copies of PV1's projection and D6's renderer. The desktop cannot import a cloud package (separate workspaces), so it mirrors them and `provenance-projection-parity.test.ts` fails on any byte of divergence. The export's Markdown is `renderProvenanceMarkdown(view)`, not a second renderer.
  - `.../provenance-export.ts` — the document (`format`, `version`, `tenantId`, `subject`, `exportedAt`, `reviewerRuleSource`, `memberLabels`, `view`, `markdown`) and `renderSignedProvenanceMarkdown`, which attaches the whole signed document to the Markdown as a compact JWS so the file stands alone.
  - `.../provenance-export-signature.ts` — ES256 over `protected + '.' + base64url(canonical(document))`, i.e. a detached JWS. `node:crypto` only; no new dependency, no lockfile change.
  - `cloud/apps/ledger-api/src/provenance-export-routes.ts` (route + unauthenticated JWKS) and `provenance-export-archive.ts` (retention seam, **no adapter** — the response says `{"stored": false, "reason": "not_configured"}`).
  - The gate half PV1 left out is now in the projection: `gate.gateId` and `gate.agreement` (GP3's four columns, all-or-nothing), plus `view.agreementCounts` and a **Gate decisions** section in the Markdown. The PR body gets it too, by construction.
- [ ] **Not built:** the desktop half — `export:save-text`, the preload bridge, the panel's Export button. The endpoint is the dependency it was waiting on.
- [ ] **Dependency:** no object store exists for product data in `cloud/` (the only bucket is the relay fence broker's GCS mutation lease, which is coordination state). Retention needs one provisioned; the adapter is a ~20-line `put` behind `ProvenanceExportArchive`.

---

### Task 10: docs

- `docs/alicorn/ARCHITECTURE.md` §7 (levels maintained by the Ledger API; window query; cap at 1 until amendments observed), §8 (new RPCs), §9 (never_gate audit view = `GET …/autonomy-policies`); `CLAUDE.md` _Working in this repo_ (+ "gates: `evaluate` only inside gateCreate; policies are admin-authored per project").
- [ ] Commit `docs(alicorn): gate policy, evidence windows, provenance export`.

---

### Task 11 (QA1, v2.0): QA blindfold enforced at the tool boundary

> Depends on the Foreman plan's Task 5 (the Orca-managed `PreToolUse` deny hook for Claude Code) and D2. Ships in v2.0 with the QA sandbox.

**Files:** `src/main/alicorn/gates/qa-blindfold.ts` (+ test), `src/main/claude/hook-settings.ts` (the lead deny hook from the Foreman plan gains a second profile), D2's `worker-member-launch.ts` hook point (one additive branch), contract `MemberInputSchema.role` already carries `qa`.

```ts
export type BlindfoldPolicy = { denyRead: string[]; allowRead: string[] } // globs relative to the worktree
export function qaBlindfoldPolicy(input: {
  worktreePath: string
  testDirs: string[]
}): BlindfoldPolicy
// denyRead: ['**'] minus allowRead: testDirs ∪ ['**/*.test.*', '**/*.spec.*', 'package.json', 'README*', 'docs/**', '.alicorn/**']
export function isReadAllowed(policy: BlindfoldPolicy, relPath: string): boolean // reuses glob-match.ts (Task 5)
```

Launch: a member with `role: 'qa'` on Claude Code gets `env ALICORN_ROLE=qa` and the managed hook denies `Read`/`Grep`/`Glob` outside the allow list with reason `qa_blindfold`; `Edit`/`Write` are allowed only under `testDirs`. Backends without a deny hook → dispatch fails with `qa_backend_unsupported` (never a prompt-line substitute). Each denied call is counted and reported in the run report (`blindfold_denials`).

- [ ] Tests: policy allows `tests/**` and denies `src/**`; hook command blocks a `Read` of `src/a.ts` and allows `tests/a.test.ts`; unsupported backend errors at dispatch. Commit `feat(alicorn): QA members cannot read the implementation — enforced at the tool boundary`.

## Self-review

- **Coverage.** GP1 (1, 2, 6), GP2 (3, 4), GP3 (7), BR1 (2, 5), PV1 (8), PV2 (9), QA1 (11). ROADMAP v1.0 exit criteria: "drag to In Review … completes with no human; the merge gate then stops and asks" — merge is `irreversible` by default (Task 2) so it always gates; the review stage can auto-resolve at level 2 once evidence exists.
- **Constraints check.** Hard stops first (Task 1 tests); authored reversibility (Task 2); evaluation only in gateCreate (Task 6; `evidence` RPC is display-only); level 0 records (Task 6); `never_gate` expiry (Task 2 refine + CHECK); per-run budgets (Task 5 union across dispatches); last-50 windows (Task 3); fail safe on missing evidence (Tasks 1, 6).
- **Types.** `GateDecision`, `AutonomyPolicy`, `GateStep`, `GateEvidence` defined once (Task 1/contract) and used by Tasks 3, 4, 6, 8. `WindowedStats.level` is what `evidence` returns and the panel shows.
- **Order.** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Needs on `main`: C3/D5 (verification record), D2 (`getDispatchMember` populated), D7 (spend). PV1/PV2 (Nghia) start after Task 4.
