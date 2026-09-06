import { tenantRlsPolicySql } from '@alicorn-cloud/control-plane-postgres'
export const LEDGER_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS step_outcomes (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL,
     run_id TEXT NOT NULL, task_id TEXT NOT NULL, dispatch_id TEXT NOT NULL,
     project_id TEXT, repo_id TEXT, worktree_id TEXT, branch TEXT,
     member_id TEXT, backend TEXT NOT NULL DEFAULT 'other',
     stage_key TEXT NOT NULL DEFAULT 'build',
     execution_strategy TEXT NOT NULL DEFAULT 'single' CHECK (execution_strategy IN ('single','orchestrated')),
     outcome TEXT NOT NULL CHECK (outcome IN ('succeeded','failed')),
     files_modified JSONB NOT NULL DEFAULT '[]'::jsonb,
     report_summary TEXT,
     spend_cents INTEGER, usage JSONB,
     gate_decision TEXT NOT NULL DEFAULT 'human',   -- level 0: every gate still fires
     gate_reason TEXT NOT NULL DEFAULT 'level0', gate_id TEXT,
     human_verdict TEXT CHECK (human_verdict IN ('accepted','rejected','amended')),
     amended_after_ms INTEGER,
     review_backend_bypass BOOLEAN NOT NULL DEFAULT false,
     escalation_offered BOOLEAN NOT NULL DEFAULT false,
     escalation_accepted BOOLEAN,
     client_ts TIMESTAMPTZ,                         -- forensics only
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- server time orders everything
     UNIQUE (tenant_id, run_id, task_id, stage_key, dispatch_id))`,
  `CREATE INDEX IF NOT EXISTS step_outcomes_track_record ON step_outcomes (tenant_id, member_id, stage_key, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS step_outcomes_branch ON step_outcomes (tenant_id, repo_id, branch, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS step_outcomes_run ON step_outcomes (tenant_id, run_id)`,
  tenantRlsPolicySql('step_outcomes'),
  `CREATE TABLE IF NOT EXISTS step_verifications (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, task_id TEXT NOT NULL, dispatch_id TEXT NOT NULL,
     kind TEXT NOT NULL, name TEXT NOT NULL, required BOOLEAN NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('passed','failed','skipped','error')),
     detail JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (tenant_id, dispatch_id, kind, name))`,
  tenantRlsPolicySql('step_verifications'),
  `CREATE TABLE IF NOT EXISTS context_captures (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, task_id TEXT NOT NULL, dispatch_id TEXT NOT NULL,
     prompt TEXT, prompt_path TEXT, prompt_bytes INTEGER NOT NULL,
     context_slice JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (tenant_id, dispatch_id))`,
  tenantRlsPolicySql('context_captures'),
  `CREATE TABLE IF NOT EXISTS member_stage_stats (   -- derived; rebuildable from step_outcomes
     tenant_id TEXT NOT NULL, member_id TEXT NOT NULL, stage_key TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
     runs INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0,
     accept_rate NUMERIC(5,4) NOT NULL DEFAULT 0, last_amended_at TIMESTAMPTZ,
     level INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, member_id, stage_key, project_id))`,
  tenantRlsPolicySql('member_stage_stats')
]
