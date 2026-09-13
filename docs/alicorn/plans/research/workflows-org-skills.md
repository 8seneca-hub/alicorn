# Plan research — Workflows & stages / Org platform & skills (v1.5)

No `.codegraph/` index exists in this worktree (codegraph MCP errors "No CodeGraph project is
loaded"); all findings below are from direct grep/Read. Every path is relative to the worktree root.

## 1. Existing code map

**Control plane (cloud/, tier-1 substrate already built):**

- `cloud/apps/control-api/src/schema-sql.ts` — `CONTROL_SCHEMA_STATEMENTS`: `members`,
  `member_skills(tenant_id, member_id, skill_id)` (no version column), `org_policies`,
  `project_required_checks(tenant_id, project_id, checks jsonb, ...)`. **No `workflows`, `stages`,
  `transitions` tables exist yet** — WF1 is greenfield at the DB layer.
- `cloud/apps/ledger-api/src/schema-sql.ts` — `step_outcomes` (has `stage_key TEXT NOT NULL DEFAULT
'build'`), `step_verifications`, `context_captures`, `member_stage_stats(tenant_id, member_id,
stage_key, project_id, runs, accepted, accept_rate, last_amended_at, level, updated_at)`.
- CRUD route template to copy for WF1: `cloud/apps/control-api/src/members-routes.ts` (GET list,
  POST create w/ 201 + duplicate-name 409 via pg error code `23505`, GET one w/ 404, PUT update,
  DELETE w/ 204) backed by `members-repository.ts` (`withTenant(pool, tenantId, fn)` wrapper per
  query) and wired in `cloud/apps/control-api/src/app.ts:11-23`
  (`registerMembersRoutes/registerOrgPolicyRoutes/registerRequiredChecksRoutes`). Same shape for
  `required-checks-routes.ts` + `required-checks-repository.ts` (project-scoped today; WF1 moves
  `required_checks` onto `stages.required_checks jsonb`, so this repo is the direct precedent).
- Contract package `cloud/packages/control-plane-contract/src/`: `member.ts` (`MemberInputSchema` —
  `skills: z.array(z.string().trim().min(1).max(200)).max(50)...refine(unique)` — **plain strings,
  no version**), `required-check.ts` (`RequiredCheckSchema = z.discriminatedUnion('kind', [...])`,
  currently one variant `diff_coverage`), `org-policy.ts`, `ledger.ts`.
- `cloud/packages/control-plane-postgres/src/`: `apply-schema.ts`, `pool.ts`,
  `postgres-test-schema.ts` (`createTestSchema`/`dropTestSchema`), `rls-policy-sql.ts`
  (`tenantRlsPolicySql`), `tenant-transaction.ts` (`withTenant`).
- `member-stage-stats.ts` (ledger-api) — `upsertMemberStageStats` is called from
  `step-outcomes-repository.ts:insertStepOutcome` (only when `input.memberId` is set), inside the
  same transaction as the `step_outcomes` insert. **No read route for `member_stage_stats` exists
  in `ledger-routes.ts`** (only `POST step-outcomes/step-verifications/context-captures`, `PATCH
spend`, `GET provenance`, `GET runs/:runId/cost`) — a gate evaluator (GP1) has nothing to query yet.

**Desktop orchestration (SQLite, client-side):**

- `src/main/runtime/orchestration/db/schema/create-alicorn-tables-sql.ts:3-13` — `ledger_outbox`
  table (kinds: `step_outcome|context_capture|spend_attribution|step_verification`) already exists,
  plus `alicorn_task_strategy` (execution_strategy, tier-1 item 1) and `alicorn_dispatch_members`
  (reviewer-backend-bypass, tier-1 item 5).
- `src/main/runtime/orchestration/db/alicorn/ledger-outbox-methods.ts` — `enqueueLedgerOutbox` /
  `listDueLedgerOutbox` / `markLedgerOutboxSent` / `markLedgerOutboxFailed`. **Grepping the whole
  `src/main` tree finds zero callers of `enqueueLedgerOutbox` or `listDueLedgerOutbox` outside their
  own test file** — the outbox table/methods are scaffolded but nothing enqueues on settlement and no
  drainer posts to the Ledger API yet. This is upstream-of-v1.5 work (tier-1 items 3/6) that WF1/SK1
  will depend on.
- **No `stageKey`/`stage_key` identifier exists anywhere in `src/main`, `src/shared`, or `src/cli`.**
  The only per-task "stage-like" concept today is the free-text `--phase` flag on `orca orchestration
send --type heartbeat`, documented in the dispatch preamble
  (`src/main/runtime/orchestration/preamble.ts:106`: `--phase "<short:
investigating|implementing|reviewing|waiting>"`) and threaded through
  `src/cli/handlers/orchestration/message-payload.ts:13,56-58` into the heartbeat payload as
  `payload.phase`. This is a **human-readable progress narration for the coordinator**, unrelated to
  workflow stages — it is not `worker_done`'s outcome and is never persisted to the ledger today.
  `src/main/runtime/orchestration/coordinator.ts:29` has an unrelated `phase: 'decomposing' |
'dispatching' | 'monitoring' | 'merging' | 'done'` — the Foreman coordinator's own run-lifecycle
  state machine, also unrelated to ledger `stage_key`.

**Skills system (large, ~180 files under `src/main/skills/`, `src/shared/skill-*.ts`,
`src/renderer/src/components/skills/`):**

- Discovery/scoping: `src/main/skills/skill-discovery-sources.ts` — `buildSkillDiscoverySources()`
  builds a flat list of `SkillScanRoot`s: per-agent **home** dirs (`~/.claude/skills`,
  `~/.codex/skills`, `~/.agents/skills`, 15 more), plus per-**repo** dirs
  (`<repo>/.claude/skills`, `<repo>/.agents/skills`, etc., lines 238-298) discovered from
  `Repo[]` + `cwd`. Types in `src/shared/skills.ts:5-43` (`SkillProvider`, `SkillSourceKind =
'home'|'repo'|'bundled'|'plugin'`, `DiscoveredSkill`, `SkillDiscoverySource`). **There is no
  "org" or "project" scope in this enum today** — `repo` is the closest thing to project scope, and
  it is purely filesystem-path-based (which repo you're in), not an org-catalog concept.
- Renderer hook `src/renderer/src/hooks/useInstalledAgentSkills.ts` —
  `useInstalledAgentSkillNames()` drives a cached, focus-refreshing scan; `GLOBAL_AGENT_SKILL_SOURCE_KINDS
= ['home']` (line 31-33) is the only place "global" vs. repo-local is distinguished today.
- Cloud "share skills" feature (unlisted-link sharing, not org catalog): `src/main/skills/
skill-cloud-service.ts`, `skill-share-preparation-service.ts`; renderer
  `src/renderer/src/components/settings/ShareSkillsSettingsPane.tsx` (toggle "Allow agents ... to
  publish skill links", "Show Skills Button"); IPC `src/main/ipc/skill-cloud-ipc-handlers.ts`. Full
  UI in `src/renderer/src/components/skills/` (`SkillShareDialog.tsx`, `SkillSharedLinksView.tsx`,
  `SkillInstallDialog.tsx`, `SkillFreshnessUpdateDialog.tsx`, etc.).
- **Skill version representation today**: `SkillPackageManifestV1` (`src/shared/
skill-package-manifest.ts:31-44`, one skill) and `SkillBundleManifestV1` (`src/shared/
skill-bundle-manifest.ts:54-67`, many skills) both carry `packageId` + `versionId` (opaque IDs,
  regex `^[A-Za-z0-9_-]{1,128}$`) plus a content digest. `SkillCloudVersion` (`src/shared/
skill-cloud-contract.ts:16-27`) is the cloud-side read model exposing `versionId`,
  `packageDigest`, `manifest`. `src/renderer/src/components/skills/
skill-managed-version-selection.ts` (`retainManagedSkillVersion`) and `src/main/skills/
skill-cloud-grant-version.ts` (`assertSkillCloudGrantVersion`) show version _is_ already pinned
  **per install location on a device** (which versionId is on disk at a given path) — but nothing
  pins a version **per member** in Postgres. `member_skills.skill_id` (control-api schema) is a bare
  string with no FK to any skill/version table.

**Folder workspaces & MCP:**

- Folder workspace model: `src/main/ipc/worktrees/folder-workspace-model.ts` (`mergeFolderWorkspace`,
  `getFolderWorkspaceRootId`), `src/main/ipc/worktrees/create/folder-workspace-creation.ts`,
  `src/main/ipc/worktrees/listing/folder-workspace-catalog.ts`,
  `src/main/ipc/worktrees/removal/remove-folder-workspace.ts`, `src/main/ipc/repos/
folder-workspace-handlers.ts`. Preload bridge: `src/preload/api/folder-workspaces-bridge.ts`
  (`list/getPathStatus/create/update/delete` over `ipcRenderer.invoke('folderWorkspaces:*')`).
- MCP config today is **repo/worktree-scoped file inspection only**, not member-scoped:
  `src/shared/mcp-config.ts` — `MCP_CONFIG_CANDIDATES` (workspace `.mcp.json`, `.cursor/mcp.json`,
  `.claude.json`, `.claude/mcp.json`, all keyed `serversPath: ['mcpServers']`),
  `inspectMcpConfigContent()` parses/validates and returns `McpServerSummary[]`. Renderer:
  `src/renderer/src/components/settings/McpConfigSection.tsx` (per-`Repo`, read/create/open the
  file, no per-member scoping, no connector installation flow). **There is no existing concept of an
  MCP connector scoped to a member/seat** — OP3 is new machinery layered on top of folder workspaces,
  not an extension of an existing per-member MCP feature.

**Org/membership UI (existing, but it is Orca's own cloud org, not Alicorn's Control API/Keycloak):**

- `src/main/ipc/orca-profile-org-members-handlers.ts` — IPC handlers
  `orcaProfiles:orgMembersList/orgMemberInvite/orgInviteRevoke/orgMemberChangeRole/orgMemberRemove`,
  arg validation (`orgRoleFromUnknown` → `'owner'|'admin'|'member'`).
- `src/main/orca-profiles/profile-cloud-org-members-service.ts` — dispatches to either the "dev"
  in-memory org store (`profile-cloud-dev-org-members.ts`) or the real HTTP client depending on
  `isOrcaCloudDevAuthEnabled()`; maps 401→reconnect-required, 403→forbidden, 404→not-found,
  409→conflict (`already_member`/`already_invited`), 400→invalid
  (`cannot_remove_self`/`cannot_change_own_role`).
- `src/main/orca-profiles/profile-cloud-org-members-client.ts` — **the exact endpoint shape to
  mirror on the Control API for OP1**: `GET /v1/desktop/orgs/:orgId/members` (returns
  `{members, pendingInvites, viewerRole, canManageMembers}`), `POST .../invites {email, role}`,
  `POST .../invites/revoke {email}`, `POST .../members/role {userId, role}`, `POST
.../members/remove {userId}`. Roles are `owner|admin|member` (line 12). This is Orca's own
  relay-backed org (separate service/DB from `cloud/apps/control-api`), so OP1 is a **parallel new
  implementation on Control API/Keycloak organisations**, not a reuse of this code path — but the
  request/response contract, role enum, and error-code mapping are a near-exact template.
- Renderer: `src/renderer/src/components/settings/OrcaAccountSettingsPane.tsx` (not read in depth;
  paired `.test.tsx` exists for the render-mock idiom).

**Canvas/graph UI precedent — none found.**

- `package.json` has no react-flow/xyflow/d3/dagre/cytoscape/konva/vis-network dependency at all.
- The only board-shaped UI is the **kanban lane board** (columns, not nodes/edges):
  `src/renderer/src/components/sidebar/WorkspaceKanbanLaneGrid.tsx`,
  `WorkspaceKanbanLaneCardList.tsx`, `WorkspaceKanbanCard.tsx`,
  `workspace-kanban-worktree-groups.ts`, plus `src/renderer/src/components/dashboard-popout/
AgentKanbanBoard.tsx` / `AgentKanbanCard.tsx`. This is the "board" half of "Stages bind to board
  columns — one model, two views" (ARCHITECTURE.md, ROADMAP.md v1.5) — reusable for the board view,
  but it is drag-and-drop lanes, not a DAG/canvas renderer. **WF2's node canvas with a first-class
  return edge has zero code or dependency precedent in this repo.**
- No "canvas"/node/DAG guidance in `docs/STYLEGUIDE.md` or `docs/alicorn/DESIGN-SYSTEM.md` — the
  word "canvas" there means the app background (`docs/STYLEGUIDE.md:32-33`), not a node-graph
  surface. WF2 will need to establish its own visual language from the design tokens in
  `src/renderer/src/assets/main.css`, following STYLEGUIDE's resolution order for anything undocumented.

## 2. Skills scoping model — today vs. target

| Scope                                    | Today                                                                                                                                                                                                                                                                   | Target (v1.5)                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home/device (per-agent-backend dir)      | Yes — `skill-discovery-sources.ts` home roots                                                                                                                                                                                                                           | unchanged                                                                                                                                                                                                                                                                                                                  |
| Repo (path-based, effectively "project") | Yes — `repo-*` roots per `Repo.path`                                                                                                                                                                                                                                    | PS1 formalizes this as a named third scope, "discovered from the repo" (committed, reviewed like code) — likely still the `.claude/skills`/`.agents/skills` dirs, but now surfaced as a first-class scope alongside org/member rather than an implicit filesystem root                                                     |
| Member (custom skill list)               | Yes but shallow — `member_skills(member_id, skill_id)`, `skill_id` is a bare string, no scope/version                                                                                                                                                                   | Extends to: a member's skill _reference_ should resolve against org catalog + project skills + per-member custom; SP1 needs to record which _version_ is pinned                                                                                                                                                            |
| Org catalog                              | Named in PROJECT-BRIEF §09 ("org catalog ... exist today") but referring to the **cloud share-link system** (`SkillCloudService`), not a first-class "org catalog" table/API — no `org_skill_catalog`-shaped table exists in `cloud/apps/control-api/src/schema-sql.ts` | OP2 needs a genuine org-scoped catalog with **stage-authored required checks** — likely a new control-api table (e.g. `org_skills` or extending `project_required_checks`'s pattern) since `RequiredCheckSchema` today is project-scoped, and WF1 is moving required-checks authorship onto `stages.required_checks jsonb` |
| Version pinning                          | Exists only as "which version is installed at this on-disk path" (`skill-cloud-grant-version.ts`, `skill-managed-version-selection.ts`), never as a per-member record                                                                                                   | SP1: add a version column/table to `member_skills` (or a sibling `member_skill_versions`), referencing the existing `SkillCloudVersion.versionId` concept                                                                                                                                                                  |

**Key gap:** there is no `skills` (catalog) table in Postgres at all today — `member_skills.skill_id`
is presently just whatever string the desktop's local skill discovery calls a skill's `id`/`name`
(see `member.ts` refine: unique strings, `.max(200)`, no format constraint). OP2/PS1/SP1 all need to
decide whether "skill" becomes a real catalog entity in Control API (with org/project/member scope
and a version history) or stays a string convention — this is the single biggest open design
question feeding all of OP1–3/PS1/SP1 (see Risks below).

## 3. Org membership flows today (for OP1)

Orca already has a full invite/role/remove flow, just against its own relay-backed org store, not
Control API/Keycloak (see file map above). The renderer/IPC/service/client layering
(`OrcaAccountSettingsPane.tsx` → `orca-profile-org-members-handlers.ts` →
`profile-cloud-org-members-service.ts` → `profile-cloud-org-members-client.ts` → relay HTTP) is the
four-layer pattern OP1 should replicate for Control API + Keycloak organisations, swapping the last
hop for Control API routes backed by Keycloak's admin API. Roles today are `owner|admin|member`
(3 roles) vs. Alicorn's `org_roles (tenant_id, user_id, role)` in `ARCHITECTURE.md:95` — same
three-role shape. `seats (tenant_id, user_id, kind)` — `builder|collaborator` — has no code
precedent anywhere in the desktop (grep for "collaborator seat" / "seats" finds nothing); OP1/OP3
are greenfield for seat kind.

## 4. Canvas options (for WF2)

No in-repo library or precedent. Options to weigh in the plan (this file doesn't decide, just
surfaces facts for the planner):

- Hand-rolled SVG/DOM node+edge renderer (matches the repo's existing zero-dependency-for-custom-UI
  style; `artifact-diagramming`-style inline SVG is the only "diagramming" convention seen anywhere
  in this environment, and it's for Artifacts, not the product).
  Consistent with repo's general aversion to adding new runtime deps for one feature (`AGENTS.md`
  "Reuse Before Reimplementing" and no chart lib anywhere despite `dataviz` skill guidance existing
  only for artifacts, not app code).
- A canvas/graph library (react-flow-class) would be a **new dependency**, which the CDN-allowlist
  and "no speculative flexibility" conventions elsewhere in this environment suggest should only be
  taken if hand-rolling is materially more expensive — worth an explicit build-vs-buy line in the
  WF2 task rather than silently picking one.
- The **board view** (`WorkspaceKanbanLaneGrid.tsx` family) is reusable as-is for "one model, two
  views" — stages bind to board columns, so the column/lane virtualization, drag-and-drop, and
  search code (`workspace-kanban-virtual-lane-layout.ts`, `use-workspace-kanban-selection.ts`, etc.)
  is a real asset for the board half of WF2, just not the node-canvas half.

## 5. Stage-key migration path (for SK1)

Current state: `stage_key` exists only in `cloud/apps/ledger-api/src/schema-sql.ts` as a column
default (`DEFAULT 'build'`) and flows through `StepOutcomeInputSchema` →
`insertStepOutcome`/`upsertMemberStageStats` (`step-outcomes-repository.ts:19,47,74,82,95`). **Nothing
in the desktop populates it** — the outbox enqueue path that will eventually set `stageKey` on a
`step_outcome` payload doesn't exist yet (no caller of `enqueueLedgerOutbox`). The only per-task
"stage-like" signal today is the free-text `--phase` heartbeat flag
(`preamble.ts:106`, `message-payload.ts:13,56-58`), which is a progress narration string typed by the
worker, never validated against a fixed set, and never written to `step_outcomes.stage_key`.

Migration path SK1 must design:

1. Whatever lands first (tier-1 items 3/6, pre-v1.5) to wire the outbox will need _some_ stage key
   per step_outcome — almost certainly hardcoded to `'build'` (matching the DB default) since no
   workflow/stage concept exists pre-v1.5.
2. Once WF1's `workflows`/`stages` tables exist and WF4 ships default templates (Spec → Architecture
   → Design → Build → Review → Verify → Merge → Deploy), SK1's job is to inject the **current
   stage's `key`** (from `stages.key`, stable per template) into the outbox payload at
   dispatch/settlement time — the natural injection point is the dispatch preamble
   (`src/main/runtime/orchestration/preamble.ts`, which already builds worker-facing CLI instructions
   per dispatch) or wherever the not-yet-built outbox-enqueue-on-settle logic lives (likely beside
   `lifecycle-reconciliation.ts`'s completion handling, since that's what currently detects
   `worker_done`).
3. `--phase` (progress narration) and `stage_key` (workflow position) are and should remain
   **separate concepts** — SK1 should not conflate them; the plan text's "replace the `worker_done
--phase` mapping" phrasing should be read as "replace the not-yet-built ad hoc/default stage-key
   assignment", since no actual `--phase`-to-`stage_key` mapping exists in code to replace.

## 6. Extension points

- **WF1 CRUD**: clone the `members-routes.ts` + `members-repository.ts` + `member.ts` (contract)
  pattern for `workflows`, `stages`, `transitions`. Add schema statements to
  `CONTROL_SCHEMA_STATEMENTS` (`cloud/apps/control-api/src/schema-sql.ts`) with
  `tenantRlsPolicySql(...)` per table (same as every existing table). Register new route files in
  `app.ts:19-21`.
- **Required checks migrate to stages**: `required-checks-repository.ts`/`required-checks-routes.ts`
  are the exact shape to adapt — swap `project_required_checks(project_id)` keying for
  `stages.required_checks jsonb` (stored directly on the stage row, per ARCHITECTURE.md §6), and
  decide whether `project_required_checks` is deprecated/removed or kept as an OP2 org-level
  fallback layer.
- **member_stage_stats reads**: needs a new route in `ledger-routes.ts` (no existing GET) for GP1
  (separate plan) and possibly for autonomy-level UI surfaced by SK1/WF-adjacent work — e.g. `GET
/v1/ledger/member-stage-stats?memberId=&stageKey=&projectId=`.
  `member-stage-stats.ts:upsertMemberStageStats` already computes `runs`/`accepted`/`accept_rate`;
  `level` and demotion (windows = last 50 runs, ARCHITECTURE.md §7) are **not yet computed anywhere**
  — `level` defaults to `0` in the schema and nothing updates it. SK1's "Level 3, automatic
  retirement and demotion" needs new logic, either in `upsertMemberStageStats` (on-write, simplest,
  matches "member_stage_stats is a cache... updated on write" rule) or a scheduled job — on-write is
  consistent with the existing single-transaction pattern and avoids a second moving part.
- **Skill scoping**: `src/main/skills/skill-discovery-sources.ts:buildSkillDiscoverySources` is the
  one function that would need a new `SkillSourceKind` (e.g. `'org'`) or a parallel org-catalog fetch
  path if PS1/OP2 want the desktop to _discover_ org/project skills the same way it discovers
  filesystem ones; alternatively OP2's org catalog could live purely server-side and never touch this
  discovery code (member's resolved skill list comes from Control API, not local disk scan) — this is
  a design fork the planner must pick, not something the code decides for you.
- **Folder-workspace MCP scoping (OP3)**: `src/shared/mcp-config.ts` inspection is generic and
  per-repo; OP3's "MCP connectors scoped to a collaborator seat" has no hook to extend — it's new
  IPC/main-process surface, most naturally a new `folderWorkspaces:*`-style bridge (see
  `folder-workspaces-bridge.ts` for the IPC naming convention) rather than touching
  `McpConfigSection.tsx`, which just inspects files and isn't an install/connector-management flow.

## 7. Test idioms

- **Control API Postgres routes**: `describePostgres = databaseUrl ? describe : describe.skip`
  keyed off `process.env.ALICORN_TEST_POSTGRES_URL`
  (`cloud/apps/control-api/src/members-routes-postgres.test.ts:17-18`); per-test-file schema name
  (`const schema = 'control_members_test'`); `createTestSchema`/`applySchema`/`dropTestSchema` +
  `openControlPlanePool` in `beforeAll`/`afterAll`; `app.request('/v1/...', {method, headers, body})`
  against the Hono app directly (no HTTP server spin-up); auth headers are a bearer token +
  `x-alicorn-actor` header; an explicit RLS test (`withTenant(pool, 'other-tenant', ...)` returns 0
  rows) appears in every such suite and should be copied verbatim for every new tenant-scoped table.
- **Renderer components**: `// @vitest-environment happy-dom`, `@testing-library/react` +
  `@testing-library/jest-dom/vitest` + `@testing-library/user-event`, `vi.hoisted()` for shared mock
  state, `vi.mock('@/store', ...)` replacing `useAppStore` with a plain selector over a mock state
  object, `vi.mock('@/i18n/i18n', ...)` returning the fallback string untranslated
  (`ShareSkillsSettingsPane.test.tsx:1-42`).

## 8. Constraints (from CLAUDE.md, binding on this plan)

- No SQLite for any new Alicorn data — `workflows`/`stages`/`transitions`, org catalog, MCP
  connector scoping records all go in Postgres behind Control API, `tenant_id` + forced RLS on every
  new table (mirroring every existing `CONTROL_SCHEMA_STATEMENTS` entry).
- Auth mode `local` only — no Keycloak org objects actually exist yet; OP1 depends on Identity
  I1–I3 (a separate, not-yet-landed plan) — this plan's OP1 tasks should be scoped as
  contract/route/repository work that can be built and tested against the constant tenant, with the
  Keycloak-organisation wiring itself flagged as blocked-on-I1–I3.
  Note also that the OrcaAccountSettingsPane/org-members flow (§3) is real, shipped Orca cloud org
  auth — separate from Keycloak/Control API and not something OP1 migrates or touches.
- Required checks stay "never authored by the member being judged" — WF1's move of
  `required_checks` onto `stages` must preserve org-admin-or-equivalent authorship, not member
  self-authorship.
- `execution_strategy` field naming is settled — do not invent a new "mode" field anywhere in
  workflows/stages/transitions.
- Renderer strings must go through localization tooling
  (`node config/scripts/localize-renderer-strings.mjs` then `sync:localization-catalog`) — every WF2/
  OP1-3 renderer task must budget for this step, not hardcode English strings (see
  `ShareSkillsSettingsPane.tsx`'s `translate('auto.components...', 'English fallback')` convention for
  the exact call shape to copy).

## 9. Risks & open questions

1. **No skill catalog entity exists.** OP2 (org catalog), PS1 (project scope), SP1 (version
   pinning) all assume some notion of a resolvable "skill" beyond a bare string in
   `member_skills.skill_id`. The planner must decide up front whether tier-1.5 introduces a real
   `skills`/`skill_versions` table in Control API, or keeps skills as filesystem-discovered strings
   with org/project catalogs as separate lists the client reconciles against. This changes the shape
   of every OP2/PS1/SP1 task.
2. **Ledger outbox has no producer or drainer.** SK1 and WF1's ledger integration both assume
   `step_outcomes` gets a real `stage_key` from the desktop, but the desktop-side wiring that would
   set any `stageKey` (enqueue-on-settle) doesn't exist. This is arguably tier-1 (pre-v1.5) work the
   v1.5 plans are implicitly depending on landing first — flag as a cross-plan dependency, not
   something to build inside WF1/SK1 tasks themselves (out of this plan's stated scope), but the
   tasks should note it as a blocking assumption.
3. **`member_stage_stats.level` is never computed.** Column exists, defaults to 0, nothing updates
   it. SK1's "Level 3, automatic retirement and demotion" is entirely new logic with no partial
   implementation to extend.
4. **WF2 canvas has a real build-vs-buy decision** with no existing dependency or convention to
   lean on — flag explicitly rather than let a task silently pick a library.
5. **OP3's "MCP connectors scoped to seats"** has no existing per-member/per-seat MCP concept
   anywhere (`McpConfigSection.tsx` is per-repo file inspection, not connector management) — treat as
   greenfield, not an extension.
6. **Two "org" concepts will coexist**: Orca's own relay-backed org (owner/admin/member,
   `profile-cloud-org-members-*`) used for skill-sharing auth today, and Alicorn's Control
   API/Keycloak org (OP1). They must not be confused in code or naming — OP1's routes are new, not a
   migration of the existing `orcaProfiles:orgMembers*` IPC surface.

## 10. Suggested task decomposition (≤2 ew each)

**Workflows & stages (WF1, WF2, WF4, SK1)**

1. **WF1a — schema + contract.** Add `workflows`/`stages`/`transitions` to
   `cloud/apps/control-api/src/schema-sql.ts` (+ RLS), new Zod schemas in
   `cloud/packages/control-plane-contract/src/workflow.ts`/`stage.ts`/`transition.ts` (model
   `required-check.ts`'s discriminated-union style for `trigger jsonb`). Proving test: Postgres
   schema test analogous to `schema-postgres.test.ts`, asserting tables + RLS forced.
2. **WF1b — CRUD routes + repository.** `workflows-routes.ts`/`workflows-repository.ts` (+ stages,
   transitions), cloned from `members-routes.ts`/`members-repository.ts`; register in `app.ts`.
   Proving test: `workflows-routes-postgres.test.ts` cloned from
   `members-routes-postgres.test.ts`, including the cross-tenant RLS assertion.
3. **WF1c — move required checks onto stages.** Decide fate of `project_required_checks`
   (deprecate vs. keep as org fallback); if deprecating, a migration task with a proving test that
   old project-scoped reads 404/redirect cleanly and stage-scoped reads return the moved data.
4. **WF4 — default template seed.** A seed/migration inserting the "Feature delivery" template
   (Spec→Architecture→Design→Build→Review→Verify→Merge→Deploy) as a `workflows` + `stages` row set,
   with `Merge`/`Deploy` stages `reversibility='irreversible'`. Proving test: fetching the seeded
   workflow returns 8 stages in order with the two irreversible stages flagged.
5. **SK1a — stage-key injection point.** Land the (currently-missing) mapping from "current stage
   of a dispatched task" to a stable `stageKey` string, sourced from the task's bound stage (once
   WF1 exists) rather than free text; wire into wherever the ledger outbox step_outcome payload gets
   built (new code, since no enqueue caller exists yet — coordinate with whichever tier-1 task lands
   that wiring first). Proving test: a settled dispatch bound to a known stage produces a
   `step_outcome` outbox payload whose `stageKey` equals `stages.key`, not `'build'`.
6. **SK1b — level 3 + demotion logic.** Implement `level` transitions and demotion (1
   rejection or 2 amendments in last 10 of last-50-window → drop one level) in/near
   `upsertMemberStageStats` (ledger-api). Proving test: a Postgres test seeding a sequence of
   `step_outcomes` inserts and asserting `member_stage_stats.level` reaches 3 at runs≥50/accept≥0.95,
   then drops to 2 after an injected rejection.
7. **WF2a — board view bound to stages.** Adapt `WorkspaceKanbanLaneGrid.tsx`'s column model so
   lanes are `stages.ordinal`-ordered from a workflow instead of ad hoc statuses. Proving test:
   renderer test asserting lane order matches `stages` fetched from Control API.
8. **WF2b — node canvas (build-vs-buy spike first).** A timeboxed spike task to decide
   hand-rolled-SVG vs. a library, _then_ the chosen renderer for nodes+edges with the return edge as
   a first-class edge type. Proving test: renderer test asserting a transition with `from_stage ==
to_stage`'s downstream target (a "return edge") renders distinctly from a forward edge.

**Org platform & skills (OP1–3, PS1, SP1)**

1. **OP1a — org/invite/role/seat schema + contract.** New Control API tables mirroring
   `org_roles`/`seats` from ARCHITECTURE §6, gated as a follow-on to Identity I1-I3 landing (build
   and test against the constant `local` tenant in the interim). Proving test: Postgres RLS test per
   new table.
2. **OP1b — invite/role/remove routes.** Mirror the exact endpoint shape of
   `profile-cloud-org-members-client.ts` (`GET .../members`, `POST .../invites`, `POST
.../invites/revoke`, `POST .../members/role`, `POST .../members/remove`) on Control API, with the
   same 403/404/409/400 error-code mapping. Proving test: route-postgres test covering each status
   code path (already_member, cannot_remove_self, etc.).
3. **OP2a — decide and land the skill-catalog entity** (blocks PS1/SP1 — see Risk 1). Proving
   test: a Postgres test that a member's resolved skill list merges org + project + custom without
   duplication.
4. **OP2b — stage-authored required checks referencing the org catalog.** Extend WF1c's
   stage-scoped required checks so a check can reference an org-catalog skill's implementation.
   Proving test: a stage's `required_checks` entry resolves to a specific org skill version.
5. **OP3 — collaborator seat MCP connector scoping.** New IPC bridge (naming convention from
   `folder-workspaces-bridge.ts`) scoping an MCP connector (Drive/SharePoint) to a folder-workspace
   member/seat. Proving test: an IPC handler test asserting a connector registered for seat A is not
   visible to seat B in the same folder workspace.
6. **PS1 — project-scoped skill discovery as a named scope.** Extend
   `skill-discovery-sources.ts`/`src/shared/skills.ts`'s `SkillSourceKind` (or a parallel path) so
   repo-committed skills surface as "project" scope distinctly from ad hoc repo dirs, discoverable
   without a local install step. Proving test: a discovery test asserting a skill in
   `<repo>/.claude/skills` reports `sourceKind`/scope reflecting "project", distinguishable from
   "home".
7. **SP1 — per-member version pin.** Add a version column/table alongside `member_skills`
   (referencing `SkillCloudVersion.versionId`), extend `MemberInputSchema`/`members-repository.ts`'s
   `replaceSkills` to carry an optional pinned version per skill. Proving test: a route-postgres test
   creating a member with a pinned skill version, then asserting a later "latest version changed"
   does not alter the member's resolved pin until explicitly updated.
