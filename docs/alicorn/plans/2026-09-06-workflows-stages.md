# Workflows & Stages Implementation Plan (v1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Caveat (v1.5):** builds on the tier-1 control plane, the tier-1 desktop plan (C3 outcome builder, D1 strategy), the gates plan (`project_stage_config`, `computeLevel`) and the board-automation plan (column → dispatch). Re-verify every anchor when picking a task up; interfaces are the commitment, line numbers are not.

**Goal:** Workflows as data — `workflows`, `stages`, `transitions` in the Control API — with the default "Feature delivery" template, stages bound to board columns (one model, two views: board and node canvas with a first-class return edge), the ledger's `stage_key` sourced from the task's bound stage instead of the `'build'` default, and Level 3 (automatic retirement with demotion) enabled per (member, stage).

**Architecture:** Stages carry what tier 1 authored per project (`required_checks`, `reversibility`, `inherited_cost`, `execution_strategy`, an optional member and autonomy policy). When a task is bound to a stage the desktop records `(task_id, workflow_id, stage_id, stage_key)` in orchestration SQLite (execution state) and every outcome carries that `stage_key`; without a workflow nothing changes (`'build'`, per-project config). The board view reuses the kanban lane grid ordered by `stages.ordinal`; the canvas is a hand-rolled SVG (nodes in ordinal order, forward edges as straight connectors, return edges as dashed arcs underneath) — no new dependency.

**Tech Stack:** Control API (hono/pg/zod, Postgres route tests with RLS assertion), `@alicorn-cloud/control-plane-contract`, orchestration SQLite migration (`SCHEMA_VERSION` bump + `create-alicorn-tables-sql.ts`), renderer kanban lane grid family, inline SVG, vitest/happy-dom.

**Spec:** `docs/alicorn/ARCHITECTURE.md` §6 (workflows/stages/transitions), §7 (levels); `docs/alicorn/ROADMAP.md` v1.5 (Workflow builder, Stages bind to board columns, Level 3); `docs/alicorn/PROJECT-BRIEF.md` §03–§04; `docs/alicorn/GRAPH-ENGINEERING.md` (stage and edge kinds); research `research/workflows-org-skills.md`. Plane: WF1, WF2, WF4, WF5, SK1 (module *Workflows & stages*, owner Nghia).

## Global Constraints

- **`execution_strategy` is the only strategy field**, values `single | orchestrated`; a stage's value is the task default when the stage dispatches. Never add a field named `mode`.
- **Required checks are authored on the stage by an admin, never by the member being judged**; project-level checks remain and are unioned with the stage's.
- **Hard stops never retire**: `Merge` and `Deploy` in the default template are `irreversible`; `reversibility`/`inherited_cost` are authored columns with no inference anywhere.
- **`stage_key` is a stable, template-defined key** (`spec, architecture, design, build, review, verify, merge, deploy` in the default template) — never the heartbeat `--phase` narration, which stays separate.
- **Level 3 is enabled only by evidence** (`computeLevel` in the Ledger API; windows of the last 50 runs; demotion on one rejection or two amendments in the last 10) and is capped at 1 while no human verdict has ever been recorded.
- **Postgres only** for workflows/stages/transitions; `tenant_id` + forced RLS on every table; additive wire changes; i18n by tooling; no AI attribution.

## Decisions made in this plan

1. **`project_required_checks` stays** as the project-level baseline; a stage's effective checks = project ∪ stage (dedup by `kind`+identity). No deprecation, no migration.
2. **Stage rows are authoritative over `project_stage_config`** when a task is bound to a stage; the project table remains the default for unbound tasks (gates plan).
3. **Task↔stage binding is execution state** → SQLite `alicorn_task_stage (task_id PK, workflow_id, stage_id, stage_key, bound_at)`; C3's outcome builder reads `stage_key` from it (fallback `'build'`).
4. **Default template seeding is idempotent per project** via `POST /v1/projects/:projectId/workflows/default` (returns the existing default if present).
5. **Canvas is hand-rolled SVG**; build-vs-buy resolved: workflows are near-linear and a library would be the only graph dependency in the app.
6. **Edge kinds** (`docs/alicorn/GRAPH-ENGINEERING.md`): `transitions.kind = forward | correction`. A correction edge is the short return path (target ordinal < source ordinal is *validated* to match; a forward edge flagged `correction` is a 400). The **learning edge** is the Rulebook, not a transition: the canvas renders it from rule data (rules attached to a member on that stage), never from this table.
9. **Stage kinds** (GRAPH-ENGINEERING.md, WF5): `stages.kind = worker | code`. A **code stage** has no member and no model: it runs `code_command` in the primary worktree and takes the forward edge on exit 0, the correction edge otherwise. The splitter is not a stage kind (it is `execution_strategy: orchestrated`) and the gate is not a node (the policy is evaluated at every hand-off).
7. **Transition trigger** is a discriminated union: `{ kind: 'column_move' }` (board), `{ kind: 'gate_resolved', resolution }`, `{ kind: 'check_failed' }` (typical return edge Review → Build), `{ kind: 'manual' }`.
8. **Level 3 behaviour** = gate still evaluated and recorded, auto-resolved without notifying the human (no inbox item/toast); blast-radius budgets still apply; retirement is announced once in the Members pane and demotion is automatic.

## File structure

```
cloud/packages/control-plane-contract/src/workflow.ts           WorkflowSchema, StageSchema/StageInputSchema, TransitionSchema, TransitionTriggerSchema, DEFAULT_FEATURE_DELIVERY
cloud/apps/control-api/src/workflows-repository.ts / workflows-routes.ts / stages-repository.ts / transitions-repository.ts
cloud/apps/control-api/src/default-workflow-seed.ts             seedDefaultWorkflow(client, tenantId, projectId)
cloud/apps/control-api/src/schema-sql.ts                         + workflows, stages, transitions
src/main/runtime/orchestration/db/schema/create-alicorn-tables-sql.ts   + alicorn_task_stage
src/main/runtime/orchestration/db/alicorn/task-stage-methods.ts
src/main/alicorn/workflows/workflow-client.ts                    alicornFetch reads/writes for workflows (cached 60 s)
src/main/alicorn/workflows/stage-key-for-task.ts                 stageKeyForTask(db, taskId): string
src/main/alicorn/workflows/code-stage-runner.ts                  runCodeStage(), codeStageOutcome() — WF5
src/renderer/src/components/workflows/WorkflowBoardView.tsx       lanes = stages.ordinal (adapts WorkspaceKanbanLaneGrid)
src/renderer/src/components/workflows/canvas/WorkflowCanvas.tsx   SVG nodes/edges; canvas-layout.ts (pure)
src/renderer/src/components/workflows/StageEditor.tsx            stage fields incl. required checks, reversibility, strategy
```

---

### Task 1 (WF1a): Schema + contract

**Files:** contract `workflow.ts`; control-api `schema-sql.ts`; `schema-postgres.test.ts` (tables exist, RLS forced).
```sql
CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, is_default BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, project_id, name));
CREATE UNIQUE INDEX IF NOT EXISTS workflows_one_default ON workflows(tenant_id, project_id) WHERE is_default;
CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id TEXT NOT NULL, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_-]{0,39}$'), name TEXT NOT NULL, ordinal INTEGER NOT NULL,
  member_id TEXT, execution_strategy TEXT NOT NULL DEFAULT 'single' CHECK (execution_strategy IN ('single','orchestrated')), reversibility TEXT NOT NULL CHECK (reversibility IN ('free','contained','irreversible')), inherited_cost TEXT NOT NULL CHECK (inherited_cost IN ('low','high')),
  required_checks JSONB NOT NULL DEFAULT '[]'::jsonb, autonomy_policy_id TEXT, board_column TEXT,
  kind TEXT NOT NULL DEFAULT 'worker' CHECK (kind IN ('worker','code')), code_command TEXT, CHECK (kind <> 'code' OR code_command IS NOT NULL), CHECK (kind <> 'code' OR member_id IS NULL),
  UNIQUE (tenant_id, workflow_id, key), UNIQUE (tenant_id, workflow_id, ordinal));
CREATE TABLE IF NOT EXISTS transitions (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id TEXT NOT NULL, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, from_stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, to_stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, trigger JSONB NOT NULL, kind TEXT NOT NULL DEFAULT 'forward' CHECK (kind IN ('forward','correction')), UNIQUE (tenant_id, from_stage_id, to_stage_id));
```
+ `tenantRlsPolicySql` ×3. Contract: `StageInputSchema` (fields above; `requiredChecks: z.array(RequiredCheckSchema)`), `TransitionTriggerSchema = z.discriminatedUnion('kind', [column_move, gate_resolved{resolution}, check_failed, manual])`, `TransitionInputSchema`, `WorkflowSchema` (with `stages[]`, `transitions[]`), `DEFAULT_FEATURE_DELIVERY` (8 stages: keys `spec, architecture, design, build, review, verify, merge, deploy`; `merge`/`deploy` `irreversible`/`high`; forward transitions `column_move`; correction edge `review → build` on `check_failed` with `kind: 'correction'`; all stages `kind: 'worker'`). `StageInputSchema.kind` defaults to `'worker'`; `codeCommand` required when `kind === 'code'` (zod refine).
- [ ] Commit `feat(control-plane): workflows, stages, transitions — schema and contract`.

### Task 2 (WF1b): CRUD routes

**Files:** `workflows-repository.ts` (+ stages/transitions repos), `workflows-routes.ts`, `app.ts` registration, `workflows-routes-postgres.test.ts` (cloned from `members-routes-postgres.test.ts`).
Routes: `GET/POST /v1/projects/:projectId/workflows`, `GET/PUT/DELETE /v1/workflows/:id`, `PUT /v1/workflows/:id/stages` (replace the ordered set; validates unique keys/ordinals; 409 when a stage in use by a bound task is removed — *use* is unknown to the Control API, so 409 only on FK violation from transitions), `PUT /v1/workflows/:id/transitions` (validates `kind === 'correction'` ⇔ `to.ordinal < from.ordinal`, both stages in the workflow). `GET /v1/workflows/:id/effective-checks/:stageKey` → project ∪ stage checks (Decision 1).
- [ ] Tests: CRUD, validation 400s (return-edge mismatch), effective checks union, RLS. Commit `feat(control-api): workflow CRUD, stage sets, transitions, effective checks`.

### Task 3 (WF4): Default template seed

**Files:** `default-workflow-seed.ts` (+ test), route `POST /v1/projects/:projectId/workflows/default` (idempotent; returns 200 existing or 201 created), `cloud/dev/scripts/seed-alicorn-local.mjs` (+ seeds the default workflow for project `local-demo`).
- [ ] Test: seeding twice returns the same id; 8 stages in ordinal order; `merge`/`deploy` irreversible; return edge present. Commit `feat(control-api): default "Feature delivery" workflow seed`.

### Task 4 (SK1a): Task↔stage binding and `stage_key` on outcomes

**Files:** `create-alicorn-tables-sql.ts` (+ `alicorn_task_stage`), migration `migrate-v3x-alicorn-task-stage.ts` (`SCHEMA_VERSION` +1), `task-stage-methods.ts` (`bindTaskStage`, `getTaskStage`), `stage-key-for-task.ts`, RPC `orchestration.stageBind { taskId, workflowId, stageId, stageKey }` (called by board automation on a column move), C3's `step-outcome-builder.ts` (Huy's file — one additive call `stageKey: stageKeyForTask(db, taskId)`; coordinate the one-line insertion), preamble: orchestrated/stage dispatches state the stage name.
- [ ] Tests: bound task → outbox payload `stageKey === stages.key`; unbound → `'build'`; migration adds the table. Commit `feat(alicorn): tasks bind to a stage; ledger outcomes carry the stage key`.

### Task 5 (SK1b): Level 3 — retirement and demotion

**Files:** ledger-api `evidence-repository.ts` (`computeLevel` already returns 0–3 — this task removes nothing; it adds `retiredAt`/`demotedAt` bookkeeping columns on `member_stage_stats` and a `GET /v1/ledger/member-levels?projectId` list), desktop gate panel (Huy's `gate-panel/` — this task adds `RetirementNotice.tsx` as a sibling and one additive prop), gate notifications (`use-gate-panel-state.ts` consumer: suppress toast/inbox when `level === 3`), Members pane read-only "Autonomy" column via `member-levels`.
- [ ] Tests: Postgres — sequence to level 3 then a rejection demotes to 2 with `demotedAt` set; renderer — level 3 resolves silently, level 2 notifies. Localise. Commit `feat(alicorn): level 3 — retired gates resolve silently; demotion is automatic and visible`.

### Task 6 (WF2a): Board view bound to stages

**Files:** `WorkflowBoardView.tsx` (+ test), `workflow-board-lanes.ts` (pure: stages → lanes by ordinal, `board_column` label), reuse `WorkspaceKanbanLaneGrid`/`WorkspaceKanbanCard`; card drop across lanes emits the board-automation `column_move` event (that plan owns dispatch) — here only the view + emit.
- [ ] Test: lane order equals stage ordinals; drop emits `{ taskId, fromStageKey, toStageKey }`. Localise. Commit `feat(alicorn): board view — lanes are workflow stages`.

### Task 7 (WF2b): Node canvas with a first-class return edge

**Files:** `canvas/canvas-layout.ts` (pure: `layoutWorkflow(stages, transitions, { nodeWidth: 160, gap: 48 }) → { nodes: [{ id, x, y }], edges: [{ id, kind: 'forward' | 'correction' | 'learning', path: string }] }` — correction edges as cubic arcs below the row, learning edges as dashed arcs above it from the stage to the member's rule badge; `learning` edges come from `GET /v1/members/:id/rule-proposals?status=accepted` (Rulebook plan) and are omitted when that route is absent), `WorkflowCanvas.tsx` (SVG; tokens from `main.css`: `--border`, `--status-attention` for correction edges, `--muted-foreground` dashed for learning edges, `--focus-ring` on the selected node; code stages drawn with a monospace label and no avatar), `StageEditor.tsx` (side panel: name, key (read-only after creation), kind, member *or* code command, `execution_strategy`, reversibility, inherited cost, required checks list, board column), save via `PUT …/stages` + `PUT …/transitions`.
- [ ] Tests: layout snapshot for the default template (8 nodes, 7 forward, 1 correction with a distinct path); component renders `data-edge-kind="correction"` and `"learning"`; editor rejects an empty key and a code stage without a command. Localise. Commit `feat(alicorn): workflow canvas — worker and code stages, forward, correction and learning edges`.

### Task 8 (WF5): code stages run without a model

**Files:** `src/main/alicorn/workflows/code-stage-runner.ts` (+ test with a fake exec), board-automation consumer (that plan's `column_move` handler calls `runCodeStage` when the target stage is `kind: 'code'` — one additive branch), C3's outcome builder (Huy's file; `memberId: null`, `backend: 'code'` accepted — additive).
```ts
export type CodeStageResult = { exitCode: number; durationMs: number; stdoutTail: string; stderrTail: string }
export async function runCodeStage(input: { worktreePath: string; command: string; timeoutMs: number; exec: RunProcess }): Promise<CodeStageResult>
// runs through runProcess (never child_process); tails capped at 4 KB; timeout → exitCode 124
export function codeStageOutcome(result: CodeStageResult): 'succeeded' | 'failed'
```
Flow: task enters a code stage → `runCodeStage` → enqueue a `step_outcome` through the outbox (`stageKey`, `memberId: null`, `backend: 'code'`, `reportSummary: stdoutTail`) → exit 0 takes the stage's forward transition, otherwise its correction edge (or gates with reason `unverified` when none exists). SSH worktrees run through the provider's exec; folder workspaces are allowed.
- [ ] Tests: exit 0 → forward; non-zero → correction edge; no correction edge → gate; timeout; outcome enqueued once. Commit `feat(alicorn): code stages — deterministic steps that never touch a model`.

### Task 9: docs — `docs/alicorn/ARCHITECTURE.md` §6 (tables as built, effective checks union, stage and edge kinds), `CLAUDE.md` *Working in this repo* ("stage keys come from the template; `--phase` is narration"), `docs/alicorn/GRAPH-ENGINEERING.md` (WF5 row → shipped). Commit `docs(alicorn): workflows and stages as built`.

## Self-review
WF1 (1, 2), WF4 (3), SK1 (4, 5), WF2 (6, 7), WF5 (8). Constraints: no `mode` field; stage checks admin-authored via routes (member has no route); irreversible defaults in the seed; `stage_key` from the template (Task 4); Level 3 evidence-gated (Task 5 relies on `computeLevel` cap); code stages go through the outbox and `runProcess` (Task 8). Types: `StageInputSchema`/`TransitionTriggerSchema` (Task 1) used by 2, 3, 7, 8; `stageKeyForTask` (Task 4) read by C3; `CodeStageResult` (Task 8) consumed by board automation. Order 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Needs on `main`: gates plan Tasks 2–3, board-automation plan (for the `column_move` consumer), C3.
