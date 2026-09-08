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
     -- GP3 level 1: what the policy would have decided, what the human decided about the gate,
     -- and whether the two matched. Distinct from human_verdict, which judges the work.
     policy_recommendation TEXT CHECK (policy_recommendation IN ('gate','auto')),
     policy_recommendation_reason TEXT,
     human_gate_decision TEXT CHECK (human_gate_decision IN ('gate','auto')),
     agreed_with_policy BOOLEAN,
     -- Was the recommendation on screen when the human decided? Level 0 collects the decision
     -- blind, so agreement measured with and without it can be compared instead of assumed.
     recommendation_shown BOOLEAN,
     human_verdict TEXT CHECK (human_verdict IN ('accepted','rejected','amended')),
     amended_after_ms INTEGER,
     review_backend_bypass BOOLEAN NOT NULL DEFAULT false,
     escalation_offered BOOLEAN NOT NULL DEFAULT false,
     escalation_accepted BOOLEAN,
     client_ts TIMESTAMPTZ,                         -- forensics only
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- server time orders everything
     UNIQUE (tenant_id, run_id, task_id, stage_key, dispatch_id))`,
  // Added after the CREATE for a database that predates GP3; the CREATE above covers a fresh one.
  `ALTER TABLE step_outcomes ADD COLUMN IF NOT EXISTS policy_recommendation TEXT`,
  `ALTER TABLE step_outcomes ADD COLUMN IF NOT EXISTS policy_recommendation_reason TEXT`,
  `ALTER TABLE step_outcomes ADD COLUMN IF NOT EXISTS human_gate_decision TEXT`,
  `ALTER TABLE step_outcomes ADD COLUMN IF NOT EXISTS agreed_with_policy BOOLEAN`,
  `ALTER TABLE step_outcomes ADD COLUMN IF NOT EXISTS recommendation_shown BOOLEAN`,
  // Reads the agreement rate for a member/stage window; partial so the level-0 blind rows and the
  // level-1 pre-filled ones stay separable without a second index.
  `CREATE INDEX IF NOT EXISTS step_outcomes_agreement ON step_outcomes (tenant_id, member_id, stage_key, created_at DESC) WHERE agreed_with_policy IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS step_outcomes_track_record ON step_outcomes (tenant_id, member_id, stage_key, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS step_outcomes_branch ON step_outcomes (tenant_id, repo_id, branch, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS step_outcomes_run ON step_outcomes (tenant_id, run_id)`,
  `CREATE INDEX IF NOT EXISTS step_outcomes_human_verdict_created_at ON step_outcomes (human_verdict, created_at) WHERE human_verdict IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS step_outcomes_tenant_task_dispatch ON step_outcomes (tenant_id, task_id, dispatch_id)`,
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
  `CREATE TABLE IF NOT EXISTS step_interruptions (
     id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
     tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, task_id TEXT NOT NULL, dispatch_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('gate','ask','escalation')),
     source_id TEXT NOT NULL,             -- gate id / question id / dispatch id (escalation)
     resolved_by TEXT, occurred_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (tenant_id, kind, source_id))`,  // exactly-once
  `CREATE INDEX IF NOT EXISTS step_interruptions_tenant_task_dispatch ON step_interruptions (tenant_id, task_id, dispatch_id)`,
  tenantRlsPolicySql('step_interruptions'),
  `CREATE TABLE IF NOT EXISTS member_stage_stats (   -- derived; rebuildable from step_outcomes
     tenant_id TEXT NOT NULL, member_id TEXT NOT NULL, stage_key TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
     runs INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0,
     accept_rate NUMERIC(5,4) NOT NULL DEFAULT 0, last_amended_at TIMESTAMPTZ,
     level INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (tenant_id, member_id, stage_key, project_id))`,
  tenantRlsPolicySql('member_stage_stats')
]
