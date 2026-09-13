# WF1 (ALC-61) — Workflows: stages/transitions entities + Control API CRUD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ticket:** [ALC-61](https://projects.8seneca.com/8seneca/browse/ALC-61/) · lane `control-plane` · estimate 2 ew · depends on A6 (shipped) · owner **Nghia** (OWNERSHIP → _Workflows & stages_).

**Goal:** A workflow is a saved object. Stages carry `member`, `reversibility`, `inherited_cost` and `required_checks`; transitions carry triggers. Control API gets CRUD over the whole graph, versioned for safe concurrent editing.

**Scope:** `cloud/` only. Tables from ARCHITECTURE §6, contract schemas, Control API routes, tests, seed. **Not** in this ticket: the node canvas (WF2/ALC-62), stage↔board-column binding (WF3/ALC-63), workflow templates (WF4/ALC-64), stable-key retirement/demotion (SK1/ALC-65), and any desktop or renderer code.

**Tech stack:** unchanged from tier 1 — Node 24, pnpm 10, TypeScript 5.9, hono 4, `pg` 8, zod **3** (`^3.25` — cloud pins 3, the desktop uses 4; never share a schema file across that boundary), vitest 4, Postgres 16.

**Spec:** `docs/alicorn/ARCHITECTURE.md` §6 (data model), §7 (autonomy — why `reversibility`/`inherited_cost` are authored not inferred), §9 (security — a member cannot loosen its own criteria); `docs/alicorn/ROADMAP.md` v1.5 _Authored workflows_; `CLAUDE.md` → _Invariants_. Precedent to mirror: `cloud/apps/control-api/src/members-{routes,repository}.ts` and `required-checks-{routes,repository}.ts`.

---

## Global constraints

- **`tenant_id` on every row, RLS enabled and forced** — including `stages` and `transitions`, whose ARCHITECTURE §6 sketch omits it. `member_skills` already sets the precedent (tenant column on a child table keyed by parent). Task 6 corrects §6.
- **`reversibility` and `inherited_cost` are authored on the stage, never inferred.** No defaulting logic that guesses from a stage name. `reversibility` defaults to the _safe_ value (`contained`), never `free`.
- **A member cannot loosen its own criteria.** `required_checks` is authored on the stage by the operator through this API; nothing in the dispatch path may write it back.
- **Wire changes are additive.** New routes, new contract module, no change to existing route shapes.
- **Auth is unchanged.** `requireTenant` already guards `/v1/*`; workflow routes inherit it and read `c.get('auth')`.
- Run every command from `cloud/`. Postgres-backed tests read `ALICORN_TEST_POSTGRES_URL` and `describe.skip` without it.
- Branch `alc-61-workflows-stages` from `main`; move the Plane issue to _In Progress_ now and _Done_ when the PR merges.

## Decisions (settled — do not relitigate mid-task)

1. **Required checks are additive; the stage wins.** `project_required_checks` and its route are untouched, so D5's `required-checks-fetch.ts` (Huy's) keeps working. Resolution is a pure function — `stage.requiredChecks` when the run has a stage, else the project's. Deprecation of the project scope waits for the v1.5 exit, and the resolution _endpoint_ waits for WF3, when stages actually bind to runs.
2. **`version` is optimistic concurrency, not a snapshot.** A monotonic int, bumped on every successful `PUT`. The client sends the version it read; a mismatch is `409 version_conflict` carrying the current version. Immutable published snapshots were considered and rejected for WF1 — roughly double the ticket, and nothing pins a version to a run until stages bind to dispatch (WF3).
3. **Stages are addressed on the wire by `key`, not by id.** Ids are internal. This keeps a save idempotent, lets a reorder be one `PUT`, and gives WF3's column bindings something stable to point at. `key` is already the ledger's join column (`step_outcomes.stage_key`, `autonomy_policies.stage_key`).
4. **The graph is written wholesale in one tenant transaction.** Stages upsert on `(workflow_id, key)`, missing keys are deleted, transitions are replaced entirely — the `replaceSkills` pattern from `members-repository.ts`, scaled up. No PATCH-per-stage surface.
5. **No unique index on `(workflow_id, ordinal)`.** A reorder would violate it mid-statement, and `DEFERRABLE` buys nothing here: ordinal contiguity is validated in zod (`0..n-1`, distinct) before any SQL runs.
6. **`stages.member_id` is `ON DELETE SET NULL`.** Deleting a member unassigns its stages rather than blocking the delete or cascading a workflow away. An unassigned stage is a visible, fixable state; a vanished workflow is not.
7. **Cycles are legal.** WF2 makes the return edge first-class, so no DAG check. What _is_ enforced: at most one transition per `(from_stage, trigger.kind)`, so dispatch is deterministic.
8. **Triggers stay small.** `on_success` | `on_failure` | `manual`. The board-column trigger arrives with WF3, as an additive member of the union.

## Files

```
cloud/packages/control-plane-contract/src/
  workflow.ts                     NEW  Stage/Transition/Workflow zod schemas + graph validation   [Huy's package — see Ownership]
  index.ts                        EDIT one re-export line
  contract.test.ts                EDIT workflow cases
cloud/apps/control-api/src/
  schema-sql.ts                   EDIT three tables + three RLS policies                          [Huy's file — additive]
  schema-postgres.test.ts         EDIT expected relname list (asserts an ordered array)           [Huy's file — must change]
  workflows-repository.ts         NEW  graph read/write in one withTenant transaction
  workflows-routes.ts             NEW  CRUD + error mapping
  workflows-routes-postgres.test.ts  NEW  gated real-Postgres suite
  required-checks-resolution.ts   NEW  resolveRequiredChecks(stage, project)
  required-checks-resolution.test.ts NEW
  app.ts                          EDIT two lines (import + register)                              [shared file — additive]
cloud/dev/scripts/
  seed-alicorn-local.mjs          EDIT append seedWorkflows()                                     [Huy's file — additive]
  seed-alicorn-local.test.mjs     EDIT one case
docs/alicorn/ARCHITECTURE.md      EDIT §6 — tenant_id on stages/transitions, key addressing, version semantics
```

### Ownership notes (OWNERSHIP.md)

- `cloud/packages/control-plane-contract` **is Huy's**: the rule is _propose field changes in the PR description rather than editing in a feature branch_. WF1 adds a new module rather than changing an existing field, so it lands in the branch — but the PR description must call out `workflow.ts` and the `index.ts` re-export explicitly, and list the enum values so the desktop mirror stays honest.
- `schema-sql.ts`, `schema-postgres.test.ts` and `cloud/dev/**` are Huy's. All three edits here are additive; `schema-postgres.test.ts` is a _required_ edit because it asserts an exact ordered table list and will go red the moment the tables land. Flag it in the PR description.
- `app.ts` is on the shared-files list: additive one-liners only, second to land rebases.

---

## Task 1 (WF1.1): Contract module `workflow.ts`

- [ ] Add `cloud/packages/control-plane-contract/src/workflow.ts`:
  - `STAGE_REVERSIBILITY = ['free', 'contained', 'irreversible']`, `INHERITED_COSTS = ['low', 'high']`, `TRIGGER_KINDS = ['on_success', 'on_failure', 'manual']` exported as `as const` (the desktop mirrors these by hand).
  - `StageKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)` — lower-kebab/snake, ≤ 63 chars, matching `step_outcomes.stage_key`'s 64-char bound with room for the terminator. SK1 will pin keys to templates; the shape is fixed now so it does not have to change then.
  - `StageInputSchema`: `key`, `name` (≤ 120, defaults to `key`), `ordinal` (int ≥ 0), `memberId` (nullable, default `null`), `reversibility` (default `'contained'` — the safe value), `inheritedCost` (default `'low'`), `requiredChecks` (`RequiredChecksSchema`, default `[]`, imported from `./required-check.js`).
  - `TriggerSchema = z.discriminatedUnion('kind', [...])` over the three kinds, each an object so WF3 can add fields additively.
  - `TransitionInputSchema`: `from` and `to` as `StageKeySchema`, `trigger`.
  - `WorkflowInputSchema`: `projectId` (1–200), `name` (trimmed, 1–120), `stages` (1–40), `transitions` (≤ 200).
  - `WorkflowGraphSchema = WorkflowInputSchema.superRefine(...)` enforcing: distinct stage keys; ordinals are exactly `0..n-1`; every transition endpoint resolves to a stage key; no self-transition; no duplicate `(from, to)`; at most one transition per `(from, trigger.kind)` (decision 7). Each failure adds a path-accurate issue so the 400 body names the offending stage.
  - `WorkflowUpdateSchema = WorkflowGraphSchema` plus `version: z.number().int().positive()`.
  - `WorkflowSchema` (read shape): input fields plus `id`, `tenantId`, `version`, `createdBy`, `createdAt`, `updatedAt`; `WorkflowSummarySchema` for the list route (`id`, `projectId`, `name`, `version`, `stageCount`, `updatedAt`).
  - Export the inferred types.
- [ ] Re-export from `index.ts` (`export * from './workflow.js'`).
- [ ] Extend `contract.test.ts`: defaults applied (`reversibility: 'contained'`, `inheritedCost: 'low'`, `requiredChecks: []`); rejects a duplicate stage key; rejects a gap in ordinals; rejects a transition to an unknown key; rejects two `on_success` edges out of one stage; **accepts a cycle** (the return edge is legal).
- [ ] `pnpm --filter @alicorn-cloud/control-plane-contract test`.

## Task 2 (WF1.2): Schema — three tables, forced RLS

- [ ] Append to `CONTROL_SCHEMA_STATEMENTS` in `cloud/apps/control-api/src/schema-sql.ts`, after `project_required_checks`:
  - `workflows (id TEXT PK DEFAULT gen_random_uuid()::text, tenant_id, project_id, name, version INT NOT NULL DEFAULT 1, created_by, created_at, updated_at)` + `CREATE UNIQUE INDEX workflows_tenant_project_name ON workflows(tenant_id, project_id, name)` (named — the 409 mapping matches on `constraint`, exactly as `members_tenant_name` does) + `tenantRlsPolicySql('workflows')`.
  - `stages (id, tenant_id, workflow_id REFERENCES workflows(id) ON DELETE CASCADE, key, ordinal INT NOT NULL, member_id TEXT REFERENCES members(id) ON DELETE SET NULL, reversibility CHECK (IN 'free','contained','irreversible'), inherited_cost CHECK (IN 'low','high'), required_checks JSONB NOT NULL DEFAULT '[]'::jsonb, name TEXT NOT NULL DEFAULT '')` + `CREATE UNIQUE INDEX stages_workflow_key ON stages(workflow_id, key)` + `CREATE INDEX stages_workflow_ordinal ON stages(workflow_id, ordinal)` + `tenantRlsPolicySql('stages')`. **No unique index on ordinal** (decision 5).
  - `transitions (id, tenant_id, workflow_id REFERENCES workflows(id) ON DELETE CASCADE, from_stage TEXT REFERENCES stages(id) ON DELETE CASCADE, to_stage TEXT REFERENCES stages(id) ON DELETE CASCADE, trigger JSONB NOT NULL)` + `CREATE UNIQUE INDEX transitions_workflow_edge ON transitions(workflow_id, from_stage, to_stage)` + `tenantRlsPolicySql('transitions')`.
- [ ] Update the expected list in `schema-postgres.test.ts` — it asserts an exact ordered array, so it goes red without this: `['member_skills', 'members', 'org_policies', 'project_required_checks', 'stages', 'transitions', 'workflows']`.
- [ ] Verify idempotency: the existing test applies the schema twice; keep every statement `IF NOT EXISTS` / DO-block guarded.
- [ ] `ALICORN_TEST_POSTGRES_URL=... pnpm --filter @alicorn-cloud/control-api test schema-postgres`.

## Task 3 (WF1.3): `workflows-repository.ts`

- [ ] `listWorkflows(pool, tenantId, projectId?)` → summaries, `ORDER BY name`, `stageCount` from a `LEFT JOIN … GROUP BY` (one query, not N+1 — `listMembers`' per-row child fetch is acceptable for ≤ 40 members but not for a graph).
- [ ] `getWorkflow(pool, tenantId, id)` → full graph or `null`. Three queries inside one `withTenant`: workflow row, stages `ORDER BY ordinal`, transitions joined back to `stages.key` on both ends so the wire shape is key-addressed (decision 3). Parse `required_checks` back through `RequiredChecksSchema` so stored JSONB regains its defaults — the `getRequiredChecks` precedent.
- [ ] `createWorkflow(pool, tenantId, createdBy, input)` → inserts at `version = 1`, then writes the graph. Duplicate name surfaces as the raw `23505`; the route maps it.
- [ ] `updateWorkflow(pool, tenantId, id, expectedVersion, input)` → inside one `withTenant`:
  - `SELECT version FROM workflows WHERE id = $1 FOR UPDATE`; `null` → not found; mismatch → return a `{ conflict: version }` discriminant (never throw for control flow).
  - `UPDATE … SET name, version = version + 1, updated_at = now()`.
  - `writeGraph(client, tenantId, workflowId, input)`: upsert stages `ON CONFLICT (workflow_id, key) DO UPDATE`, `DELETE FROM stages WHERE workflow_id = $1 AND key <> ALL($2)`, then `DELETE FROM transitions WHERE workflow_id = $1` and re-insert resolving keys → ids from the just-written stage rows. Deleting a stage cascades its transitions; re-inserting after the delete keeps ordering safe.
  - Re-read and return the full graph, so the response always shows the persisted state including the new version.
- [ ] `deleteWorkflow(pool, tenantId, id)` → boolean; stages and transitions cascade.
- [ ] Keep the file under the repo's `max-lines`; if `writeGraph` pushes it over, split to `workflow-graph-write.ts` — never add a lint disable.

## Task 4 (WF1.4): `workflows-routes.ts` + registration

- [ ] Routes, all under the existing `requireTenant` guard:
  - `GET /v1/workflows` (optional `?projectId=`) → `{ workflows }`.
  - `POST /v1/workflows` → `201 { workflow }`; `400 invalid_body` with zod issues; `409 duplicate_name` matched on constraint `workflows_tenant_project_name` (mirror `isDuplicateNameViolation`).
  - `GET /v1/workflows/:id` → `{ workflow }` | `404 not_found`.
  - `PUT /v1/workflows/:id` → body `WorkflowUpdateSchema`; `404 not_found`; `409 { error: 'version_conflict', version }`; `409 duplicate_name`; else `{ workflow }` at the new version.
  - `DELETE /v1/workflows/:id` → `204` | `404 not_found`.
- [ ] Register in `app.ts` — one import, one `registerWorkflowsRoutes(app, deps)` call. Additive only; rebase if Huy lands first.
- [ ] `workflows-routes-postgres.test.ts`, gated on `ALICORN_TEST_POSTGRES_URL`, mirroring `members-routes-postgres.test.ts`: create → read back with ordered stages; duplicate name → 409; stale version → 409 carrying the current version; a successful `PUT` bumps the version by exactly one; renaming a stage key deletes the old stage and its edges; reordering stages is one `PUT` with no constraint violation; deleting the referenced member leaves the stage with `memberId: null`; unknown id → 404 on GET/PUT/DELETE; a request without the bearer → 401 (proves the guard covers the new prefix).

## Task 5 (WF1.5): Required-checks resolution

- [ ] `required-checks-resolution.ts`: `resolveRequiredChecks(stageChecks: RequiredCheck[] | null, projectChecks: RequiredCheck[]): { checks, source: 'stage' | 'project' }`. A stage that exists and authors checks wins; a stage with an **empty** array is a deliberate "no checks here" and still wins — only a _missing_ stage falls back to the project. Returning `source` keeps the eventual provenance line ("checks came from the stage") honest.
- [ ] Unit tests for all four cases: no stage → project; stage with checks → stage; stage with `[]` → stage, empty; neither → `[]`.
- [ ] Wire nothing to it yet (decision 1). Add a one-line comment naming WF3 as the consumer so the next reader does not think it is dead code.

## Task 6 (WF1.6): Seed, docs, close-out

- [ ] `cloud/dev/scripts/seed-alicorn-local.mjs`: append `seedWorkflows(client, tenantId, members)` creating one workflow, `Feature delivery`, on project `local`: stages `spec` → `build` → `review` → `qa`, `build` assigned to the seeded Developer, `review` to the Reviewer, `qa` to the QA member; `review` and `qa` carry `reversibility: 'contained'`; transitions `on_success` down the chain plus the return edge `review --on_failure--> build`, so the first thing anyone sees exercises the case WF2 is built around. Idempotent via `ON CONFLICT (tenant_id, project_id, name) DO NOTHING`, matching `seedMembers`. Extend `seed-alicorn-local.test.mjs` with one case.
- [ ] `docs/alicorn/ARCHITECTURE.md` §6: add `tenant_id` to the `stages` and `transitions` sketches, add `stages.name`, note that the wire addresses stages by `key`, and state that `version` is optimistic-concurrency (bumped per save) rather than a published snapshot. Same spirit as A10.
- [ ] Note in the PR description: the new contract module and its enum values (Huy's package), the forced `schema-postgres.test.ts` edit, the `app.ts` one-liner, and the seed edit.
- [ ] `pnpm -r typecheck && pnpm -r test` from `cloud/`, once with `ALICORN_TEST_POSTGRES_URL` set so the gated suites actually run.
- [ ] Move ALC-61 to _Done_ when the PR merges.

---

## Self-review

- Every table carries `tenant_id` with `FORCE ROW LEVEL SECURITY`, verified by the existing schema test's `relforcerowsecurity` query rather than by assertion in prose.
- `reversibility` and `inherited_cost` are stored exactly as authored; no code path infers either, and the default is the safe one.
- Nothing in a dispatch path writes `required_checks` — the only writer is the operator-facing `PUT`.
- The version check is `SELECT … FOR UPDATE` inside the same transaction as the write, so two concurrent saves cannot both see the same version and both win.
- No new wire field on an existing route; every change is a new path or a new module.
- Followers are unblocked: WF2 gets a graph to render, WF3 gets stable stage keys to bind columns to, SK1 gets a key format that already matches `step_outcomes.stage_key`.
