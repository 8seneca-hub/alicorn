import { tenantRlsPolicySql } from '@alicorn-cloud/control-plane-postgres'
export const CONTROL_SCHEMA_STATEMENTS: readonly string[] = [
  // Identity tables (users, tenants, org_roles, cloud_profiles) arrive with the Keycloak plan.
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
  tenantRlsPolicySql('member_skills'),
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
     trigger JSONB NOT NULL)`,
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
