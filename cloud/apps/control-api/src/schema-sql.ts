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
  tenantRlsPolicySql('project_required_checks')
]
