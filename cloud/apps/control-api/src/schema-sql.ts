import { tenantRlsPolicySql } from '@alicorn-cloud/control-plane-postgres'
import { IDENTITY_SCHEMA_STATEMENTS } from './identity-schema-sql.js'
export const CONTROL_SCHEMA_STATEMENTS: readonly string[] = [
  // Identity first: every product row's `created_by` is a `users.id`, so the identity tables have
  // to exist before anything that references one.
  ...IDENTITY_SCHEMA_STATEMENTS,
  // A project: what a board, a workflow and a set of required checks belong to. Additive rather
  // than a migration, because `project_id` is an opaque TEXT column with no foreign key on every
  // table that takes one — a tenant with no rows here behaves exactly as it did before.
  `CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY DEFAULT ('prj_' || gen_random_uuid()::text),
     tenant_id TEXT NOT NULL,
     name TEXT NOT NULL,
     key TEXT NOT NULL,
     created_by TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_tenant_name ON projects(tenant_id, name)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_tenant_key ON projects(tenant_id, key)`,
  tenantRlsPolicySql('projects'),
  // Why repo_id is the primary key and not (project_id, repo_id): a repository belongs to at most
  // one project. Two would make "which project is this gate in" unanswerable, and that question
  // has to have exactly one answer for a queue to be readable one project at a time.
  `CREATE TABLE IF NOT EXISTS project_repos (
     tenant_id TEXT NOT NULL,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     repo_id TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, repo_id))`,
  `CREATE INDEX IF NOT EXISTS project_repos_project ON project_repos(tenant_id, project_id)`,
  tenantRlsPolicySql('project_repos'),
  // The unit of work (PRODUCT-ARCHITECTURE §2). The `(repo, branch, worktree)` tuples a task binds
  // stay in the client's orchestration SQLite — execution is on the client, and a worktree path
  // names nothing on another host — so this row is the ticket, not how it is being worked on.
  `CREATE TABLE IF NOT EXISTS tasks (
     id TEXT PRIMARY KEY DEFAULT ('tsk_' || gen_random_uuid()::text),
     tenant_id TEXT NOT NULL,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     number INTEGER NOT NULL,
     title TEXT NOT NULL,
     context TEXT NOT NULL DEFAULT '',
     column_id TEXT NOT NULL DEFAULT 'todo',
     execution_strategy TEXT NOT NULL DEFAULT 'single'
       CHECK (execution_strategy IN ('single', 'orchestrated')),
     stage_key TEXT,
     source_provider TEXT,
     source_ref TEXT,
     source_url TEXT,
     created_by TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     closed_at TIMESTAMPTZ)`,
  // The sequence behind PAY-142. Unique per project so a concurrent create collides (23505) and
  // retries, rather than two tickets sharing a number that people then quote at each other.
  `CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_number ON tasks(tenant_id, project_id, number)`,
  `CREATE INDEX IF NOT EXISTS tasks_project_column ON tasks(tenant_id, project_id, column_id)`,
  // Tables created before PM import gain the columns here; `CREATE TABLE IF NOT EXISTS` above only
  // ever builds a fresh one.
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_provider TEXT`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_ref TEXT`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_url TEXT`,
  // Importing the same board twice must not duplicate its tickets, so the provider's own id is
  // unique per project. Partial: a task typed here has no source and many may share that absence.
  `CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_source
     ON tasks(tenant_id, project_id, source_provider, source_ref)
     WHERE source_ref IS NOT NULL`,
  tenantRlsPolicySql('tasks'),
  `CREATE TABLE IF NOT EXISTS task_members (
     tenant_id TEXT NOT NULL,
     task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     member_id TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, task_id, member_id))`,
  `CREATE INDEX IF NOT EXISTS task_members_task ON task_members(tenant_id, task_id)`,
  tenantRlsPolicySql('task_members'),
  // Product configuration — tenant-scoped, RLS forced.
  `CREATE TABLE IF NOT EXISTS members (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL,
     name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('developer', 'reviewer', 'qa', 'analyst', 'other')),
     backend TEXT NOT NULL CHECK (backend IN ('claude', 'codex', 'grok', 'openclaude')),
     workspace_kind TEXT NOT NULL CHECK (workspace_kind IN ('worktree', 'folder')),
     permission_mode TEXT NOT NULL CHECK (permission_mode IN ('ask', 'accept_edits', 'yolo')),
     system_rules TEXT NOT NULL DEFAULT '',
     created_by TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS members_tenant_name ON members(tenant_id, name)`,
  tenantRlsPolicySql('members'),
  `CREATE TABLE IF NOT EXISTS member_skills (
     tenant_id TEXT NOT NULL,
     member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     skill_id TEXT NOT NULL,
     PRIMARY KEY (member_id, skill_id))`,
  // OP2: a member's skills are additive to the catalog, never a mutation of it — `skill_id` stays
  // the skill *name*, and `version_id` NULL means "follow the catalog's latest".
  `ALTER TABLE member_skills ADD COLUMN IF NOT EXISTS version_id TEXT`,
  tenantRlsPolicySql('member_skills'),
  // The org skill catalog (OP2/SP1a). Admin-authored: this is what a stage check names, so it has
  // to be out of reach of the member being judged. Versions reuse Orca's skill-manifest
  // vocabulary (packageId/versionId/digest) rather than inventing a second one.
  `CREATE TABLE IF NOT EXISTS skills (
     id TEXT PRIMARY KEY DEFAULT ('skl_' || gen_random_uuid()::text),
     tenant_id TEXT NOT NULL,
     scope TEXT NOT NULL CHECK (scope IN ('org', 'project')),
     project_id TEXT,
     name TEXT NOT NULL,
     package_id TEXT,
     latest_version_id TEXT,
     created_by TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CHECK ((scope = 'project') = (project_id IS NOT NULL)))`,
  // Why two partial indexes rather than UNIQUE(tenant_id, project_id, name): NULL project_id is
  // the org-wide row, and Postgres treats NULLs as distinct, so the org name would duplicate.
  `CREATE UNIQUE INDEX IF NOT EXISTS skills_tenant_org_name ON skills(tenant_id, name) WHERE project_id IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS skills_tenant_project_name ON skills(tenant_id, project_id, name) WHERE project_id IS NOT NULL`,
  tenantRlsPolicySql('skills'),
  // Publishing is idempotent on (skill_id, version_id) — a re-post of the same version is a no-op,
  // never a second row that `latest` could then point at ambiguously.
  `CREATE TABLE IF NOT EXISTS skill_versions (
     tenant_id TEXT NOT NULL,
     skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
     version_id TEXT NOT NULL,
     digest TEXT NOT NULL,
     manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
     published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (skill_id, version_id))`,
  tenantRlsPolicySql('skill_versions'),
  `CREATE TABLE IF NOT EXISTS org_policies (
     tenant_id TEXT PRIMARY KEY,
     enforce_distinct_reviewer_backend BOOLEAN NOT NULL DEFAULT true,
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  tenantRlsPolicySql('org_policies'),
  `CREATE TABLE IF NOT EXISTS project_required_checks (
     tenant_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     checks JSONB NOT NULL DEFAULT '[]'::jsonb,
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, project_id))`,
  tenantRlsPolicySql('project_required_checks'),
  // BR1: the reach half of a blast-radius budget. Authored by an org admin, never by the member
  // being judged, and never inferred from what a run happened to touch.
  `CREATE TABLE IF NOT EXISTS project_protected_paths (
     tenant_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     paths JSONB NOT NULL DEFAULT '[]'::jsonb,
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, project_id))`,
  tenantRlsPolicySql('project_protected_paths'),
  // CR2: who accepted a breaking interface change, per run. The contracts themselves live in the
  // run's journal on disk; only the acknowledgement is server-side, because only the
  // acknowledgement has to be out of reach of the member whose contract broke.
  `CREATE TABLE IF NOT EXISTS contract_acknowledgements (
     tenant_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     run_id TEXT NOT NULL,
     contract_name TEXT NOT NULL,
     acknowledged_by TEXT NOT NULL,
     acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, project_id, run_id, contract_name))`,
  tenantRlsPolicySql('contract_acknowledgements'),
  // Workflows — authored stage graphs (WF1). Stages are addressed on the wire by `key`;
  // ids stay internal so a save is idempotent and a reorder is one request.
  `CREATE TABLE IF NOT EXISTS workflows (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     name TEXT NOT NULL,
     version INTEGER NOT NULL DEFAULT 1,
     created_by TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS workflows_tenant_project_name ON workflows(tenant_id, project_id, name)`,
  `CREATE INDEX IF NOT EXISTS workflows_tenant_project ON workflows(tenant_id, project_id)`,
  tenantRlsPolicySql('workflows'),
  // Why: reversibility and inherited_cost are authored here and never inferred (ARCHITECTURE §7);
  // required_checks is authored on the stage, never by the member being judged (§9).
  `CREATE TABLE IF NOT EXISTS stages (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL,
     workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
     key TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     ordinal INTEGER NOT NULL,
     member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
     column_id TEXT,
     kind TEXT NOT NULL DEFAULT 'worker' CHECK (kind IN ('worker', 'code')),
     code_command TEXT,
     reversibility TEXT NOT NULL DEFAULT 'contained' CHECK (reversibility IN ('free', 'contained', 'irreversible')),
     inherited_cost TEXT NOT NULL DEFAULT 'low' CHECK (inherited_cost IN ('low', 'high')),
     required_checks JSONB NOT NULL DEFAULT '[]'::jsonb)`,
  `ALTER TABLE stages ADD COLUMN IF NOT EXISTS column_id TEXT`,
  `ALTER TABLE stages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'worker'`,
  `ALTER TABLE stages ADD COLUMN IF NOT EXISTS code_command TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS stages_workflow_key ON stages(workflow_id, key)`,
  // Why unique: two stages on one column would make a board move ambiguous, and the engine would
  // have to guess which member to dispatch.
  `CREATE UNIQUE INDEX IF NOT EXISTS stages_workflow_column ON stages(workflow_id, column_id) WHERE column_id IS NOT NULL`,
  // Why: no unique index on (workflow_id, ordinal) — a reorder would violate it mid-statement,
  // and contiguity is already enforced by the wire schema before any SQL runs.
  `CREATE INDEX IF NOT EXISTS stages_workflow_ordinal ON stages(workflow_id, ordinal)`,
  tenantRlsPolicySql('stages'),
  `CREATE TABLE IF NOT EXISTS transitions (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL,
     workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
     from_stage TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
     to_stage TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
     kind TEXT NOT NULL DEFAULT 'forward' CHECK (kind IN ('forward', 'correction')),
     trigger JSONB NOT NULL)`,
  // WF1 rows predate the kind, so they arrive as 'forward'.
  `ALTER TABLE transitions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'forward'`,
  // ...but a WF1 edge to a lower ordinal *is* a return, and leaving it labelled 'forward' would
  // both draw the wrong arc and make the row un-resaveable — the wire schema now rejects that
  // pairing. Idempotent: post-WF2 no such row can exist.
  `UPDATE transitions tr SET kind = 'correction'
     FROM stages f, stages t
     WHERE tr.from_stage = f.id AND tr.to_stage = t.id AND t.ordinal < f.ordinal AND tr.kind = 'forward'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS transitions_workflow_edge ON transitions(workflow_id, from_stage, to_stage)`,
  tenantRlsPolicySql('transitions'),
  // Rulebook (v1.5): a human-corrected step proposes a standing rule on the member that caused it.
  `CREATE TABLE IF NOT EXISTS rule_proposals (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id TEXT NOT NULL, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     outcome_id TEXT NOT NULL, verdict TEXT NOT NULL CHECK (verdict IN ('amended','rejected')), context JSONB NOT NULL, proposed_rule TEXT,
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')), decided_by TEXT, decided_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (tenant_id, outcome_id))`,
  tenantRlsPolicySql('rule_proposals'),
  // Autonomy policy (GP1). Admin-authored per project; `member_id` NULL means "every member on
  // this stage". A never_gate exception must lapse — §9 — so the CHECK is here as well as in zod.
  `CREATE TABLE IF NOT EXISTS autonomy_policies (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     stage_key TEXT NOT NULL DEFAULT 'build',
     member_id TEXT,
     mode TEXT NOT NULL CHECK (mode IN ('always_gate', 'evidence', 'never_gate')),
     min_runs INTEGER NOT NULL DEFAULT 10,
     min_accept_rate NUMERIC(5,4) NOT NULL DEFAULT 0.9,
     max_files INTEGER,
     max_spend_cents INTEGER,
     created_by TEXT NOT NULL,
     expires_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CHECK (mode <> 'never_gate' OR expires_at IS NOT NULL))`,
  // Why a partial index pair rather than UNIQUE(...): NULL member_id is the wildcard row, and
  // Postgres treats NULLs as distinct in a unique constraint, so the wildcard would duplicate.
  `CREATE UNIQUE INDEX IF NOT EXISTS autonomy_policies_scope
     ON autonomy_policies(tenant_id, project_id, stage_key, member_id) WHERE member_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS autonomy_policies_stage_wildcard
     ON autonomy_policies(tenant_id, project_id, stage_key) WHERE member_id IS NULL`,
  tenantRlsPolicySql('autonomy_policies'),
  // ARCHITECTURE §7: reversibility and inherited_cost are authored, never inferred. Tier 1 has no
  // stages, so they are authored per project + stage key; this becomes `stages.*` once a workflow
  // is attached to the task being gated.
  `CREATE TABLE IF NOT EXISTS project_stage_config (
     tenant_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     stage_key TEXT NOT NULL,
     reversibility TEXT NOT NULL CHECK (reversibility IN ('free', 'contained', 'irreversible')),
     inherited_cost TEXT NOT NULL CHECK (inherited_cost IN ('low', 'high')),
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, project_id, stage_key))`,
  tenantRlsPolicySql('project_stage_config')
]
