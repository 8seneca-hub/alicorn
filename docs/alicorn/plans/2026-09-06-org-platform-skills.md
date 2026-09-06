# Org Platform & Skills Implementation Plan (v1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Caveat (v1.5):** OP1 is blocked on the identity plan (I1–I3: Keycloak organisations) for anything beyond the constant `local` tenant; build and test the tables/routes against `local` and wire Keycloak when it lands. Re-verify anchors when picking a task up.

**Goal:** A real skill entity in the control plane so a Member's skills resolve against an org catalog, project-committed skills and its own pins (with a version pinned per member); org membership and seats on the Control API in the same shape Orca's relay org already uses; MCP connectors scoped to a collaborator seat in folder workspaces.

**Architecture:** Skills become a catalog entity (`skills`, `skill_versions`) in the Control API, keyed by the existing `packageId`/`versionId`/digest vocabulary from Orca's skill manifests, so nothing is invented for versions. Resolution is client-side and pure: `resolveMemberSkills(memberSkills, orgCatalog, projectSkills)` merges three scopes with precedence *member pin > project > org* and dedup by name. Org membership (`org_roles`, `seats`) mirrors the relay client's endpoint contract and error mapping but is a separate implementation on the Control API — the two orgs never share code paths or names. Seat-scoped MCP connectors are records in the Control API that main materialises into a per-seat `.mcp.json` at launch for that seat only.

**Tech Stack:** Control API (hono/pg/zod), `@alicorn-cloud/control-plane-contract`, `src/main/skills/*` discovery (read-only reuse), `src/shared/skill-package-manifest.ts` (`packageId`/`versionId`), `src/shared/mcp-config.ts` (`McpServerSummary`), folder-workspace bridge naming, vitest.

**Spec:** `docs/alicorn/ARCHITECTURE.md` §6 (`org_roles`, `seats`, `member_skills`); `docs/alicorn/PROJECT-BRIEF.md` §03 (Members, skills), §09 (org catalog, collaborator seats); `CLAUDE.md` (Members; two org concepts must not be confused); research `research/workflows-org-skills.md` §2–§3, §9. Plane: OP1, OP2, OP3, PS1, SP1 (module *Org platform & skills*, owner Huy).

## Global Constraints
- **Two org concepts coexist**: Orca's relay-backed org (`orcaProfiles:orgMembers*`, skill sharing) is untouched; Alicorn's org lives on the Control API under `/v1/org/*` and `alicorn:org:*` IPC names. Never route one through the other.
- **Roles are `owner | admin | member`; seat kinds are `builder | collaborator`** (ARCHITECTURE §6). Role checks are enforced in the Control API once identity lands; in `local` mode the caller is `owner`.
- **A member's skill list is additive to the catalog, never a mutation of it**: `member_skills` references catalog skills or project skills by name; only admins write the catalog.
- **Stage-authored checks may reference a catalog skill, never a member's private skill** (a member cannot loosen its own criteria).
- Postgres only; `tenant_id` + forced RLS on every table; additive wire changes; i18n by tooling; no AI attribution.

## Decisions
1. **Skill catalog entity**: `skills (id, tenant_id, scope 'org'|'project', project_id nullable, name, package_id nullable, latest_version_id nullable)` + `skill_versions (skill_id, version_id, digest, manifest jsonb, published_at)`; `member_skills` gains `version_id TEXT` (nullable = follow latest) and keeps `skill_id` as the *name* for backward compatibility (renamed to `skill_name` in the contract type only).
2. **Project skills (PS1) are not uploaded**: they are the repo-committed dirs Orca already discovers (`<repo>/.claude/skills`, `.agents/skills`); PS1 labels them scope `project` in the resolved list and in the Skills UI; they are reviewed like code.
3. **Resolution precedence**: member pin > project > org; dedup by `name`; result carries `scope` and `versionId | null`.
4. **OP1 endpoint shape** copies `profile-cloud-org-members-client.ts` verbatim under `/v1/org/members`, `/v1/org/invites`, `/v1/org/invites/revoke`, `/v1/org/members/role`, `/v1/org/members/remove`, with error codes `already_member`, `already_invited`, `cannot_remove_self`, `cannot_change_own_role`, `forbidden`, `not_found`. Invites are rows until Keycloak sends mail (identity plan).
5. **OP3 connector kinds** start with `gdrive` and `sharepoint`; config is an MCP server entry (`command`, `args`, `env` names — never secret values; secrets come from the seat holder's own keychain at launch).

## Tasks

### Task 1 (OP2a/SP1a): skill catalog schema + contract
`skills`, `skill_versions` tables (RLS); `member_skills` `ALTER TABLE … ADD COLUMN IF NOT EXISTS version_id TEXT`; contract `skill.ts`: `SkillSchema`, `SkillVersionSchema`, `SkillInputSchema`, `MemberSkillRefSchema = { name, versionId: z.string().nullable().default(null) }`; `MemberInputSchema.skills` accepts `string | MemberSkillRef` (strings normalise to `{ name, versionId: null }` — additive). Postgres schema test + contract tests.
- [ ] Commit `feat(control-plane): skill catalog entity; member skill refs may pin a version`.

### Task 2 (OP2a): catalog routes
`GET/POST /v1/skills?scope&projectId`, `GET /v1/skills/:id`, `POST /v1/skills/:id/versions` (`{ versionId, digest, manifest }`; idempotent on `(skill_id, version_id)`), `PUT /v1/skills/:id/latest { versionId }`. Admin-only (local = owner). Route tests + RLS.
- [ ] Commit `feat(control-api): org and project skill catalog`.

### Task 3 (SP1b/PS1): resolution in main + Members pane pin
`src/main/alicorn/skills/resolve-member-skills.ts` (pure, Decision 3, + test with three-scope fixtures and a pin that survives a `latest` change), `src/main/alicorn/skills/project-skills.ts` (maps `DiscoveredSkill` with `sourceKind === 'repo'` for the project's repos → `{ name, scope: 'project' }`), IPC `alicorn:skills:resolve { memberId, projectId }`; Members pane (Nghia's) gets a sibling `MemberSkillsResolved.tsx` (Huy) showing scope badges and a version pin selector writing `versionId` through the members `PUT` (additive). Localise.
- [ ] Commit `feat(alicorn): resolved member skills — org, project, pinned versions`.

### Task 4 (OP2b): stage checks referencing a catalog skill
`RequiredCheckSchema` gains variant `{ kind: 'skill', skillId, versionId?: string }` (additive). Control API validates `skillId` exists in the org catalog (400 `unknown_skill`; project-scoped skills allowed only for the same project; member private skills impossible by construction). Evaluation (which member runs it) is the QA plan's job; this task stores and validates. Tests.
- [ ] Commit `feat(control-plane): required checks may reference a catalog skill version`.

### Task 5 (OP1a): org roles + seats schema
```sql
CREATE TABLE IF NOT EXISTS org_roles (tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner','admin','member')), email TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, user_id));
CREATE TABLE IF NOT EXISTS org_invites (tenant_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','member')), invited_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, email));
CREATE TABLE IF NOT EXISTS seats (tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('builder','collaborator')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, user_id));
```
+ RLS; contract `org.ts` (`OrgRoleSchema`, `OrgMembersResponseSchema = { members, pendingInvites, viewerRole, canManageMembers }`, `SeatSchema`). Schema tests.
- [ ] Commit `feat(control-plane): org roles, invites and seats`.

### Task 6 (OP1b): membership routes (Decision 4)
`org-members-routes.ts`/`-repository.ts`; `local` mode: the actor is `owner` of tenant `local`; identity mode (later): `auth.userId` + role from `org_roles`. Error mapping per Decision 4. Route tests for every status path (409 `already_member`/`already_invited`, 400 `cannot_remove_self`/`cannot_change_own_role`, 403, 404). **Note in the route file header: Keycloak organisation sync (creating the KC org member / sending the invite) lands with the identity plan (I3).**
- [ ] Commit `feat(control-api): org membership — list, invite, revoke, role, remove`.

### Task 7 (OP1c): Alicorn org settings pane
`src/renderer/src/components/settings/AlicornOrgSettingsPane.tsx` (+ test; pattern from `OrcaAccountSettingsPane.test.tsx`), IPC `alicorn:org:*` (main → `alicornFetch('control', '/v1/org/…')`), preload `alicorn-org-*.ts`. Copy explicitly distinguishes "Alicorn organisation" from the Orca account org. Localise.
- [ ] Commit `feat(alicorn): organisation settings — members, invites, seats`.

### Task 8 (OP3): seat-scoped MCP connectors
Control API: `seat_connectors (tenant_id, user_id, kind CHECK IN ('gdrive','sharepoint'), server JSONB, created_at, PRIMARY KEY (tenant_id, user_id, kind))` + routes `GET/PUT/DELETE /v1/org/seats/:userId/connectors/:kind` (admin or the seat holder). Desktop: `src/main/alicorn/connectors/seat-mcp-config.ts` — `materialiseSeatMcpConfig(folderWorkspacePath, connectors) → writes <workspace>/.alicorn/mcp.<userId>.json` and the launch path for a collaborator's agent in that folder workspace passes `--mcp-config` pointing at it (Claude/Codex flags where supported); a builder seat in the same workspace never sees another seat's file (test: two seats → two files, each launch reads only its own). IPC `alicorn:connectors:*`; a small section in the folder-workspace settings. Localise.
- [ ] Commit `feat(alicorn): MCP connectors scoped to a collaborator seat`.

### Task 9: docs — ARCHITECTURE §6 (skills catalog, `member_skills.version_id`, org tables), CLAUDE.md note "two orgs: Orca account org vs Alicorn organisation". Commit `docs(alicorn): skills catalog and organisation platform`.

### Task 10 (PA1, v2.0): policy at scale — org budgets and the exceptions audit

> Depends on BR1 (gates plan Task 2/5) and OP1 (Tasks 5–7 here). v2.0.

Control API: `org_budgets (tenant_id PK, max_spend_cents_per_run INTEGER, max_spend_cents_per_day INTEGER, max_files_per_run INTEGER, updated_by, updated_at)` + RLS; `GET/PUT /v1/org/budgets` (admin). Gate evaluation (gates plan `gate-evaluation.ts`) takes `min(projectPolicy.maxX, orgBudget.maxX)` — an org budget can only tighten a project policy, never loosen it; daily spend comes from the Ledger API `GET /v1/ledger/spend?since` (additive route). Audit: `GET /v1/org/exceptions` lists every active and expired `never_gate` policy across projects with author and expiry; the org settings pane (Task 7) gains "Budgets" and "Exceptions" sections. Tests: org budget tightens, cannot loosen; exceptions list spans projects; RLS.
- [ ] Localise. Commit `feat(alicorn): org-level budgets and the never_gate exceptions audit`.

## Self-review
OP1 (5, 6, 7), OP2 (1, 2, 4), OP3 (8), PS1 (3), SP1 (1, 3), PA1 (10). Constraints: two orgs separated by route/IPC namespaces (Tasks 6–7); catalog admin-only (Task 2); checks reference catalog only (Task 4); RLS on every table. Types: `MemberSkillRefSchema` (1) used by 3; `SkillSchema` (1) by 2, 4; `OrgMembersResponseSchema` (5) by 6, 7. Order 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9; Task 6's Keycloak sync is a named follow-on in the identity plan.
