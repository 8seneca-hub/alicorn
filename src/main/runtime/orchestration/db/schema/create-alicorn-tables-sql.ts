export function createAlicornTablesSql(): string {
  return `
CREATE TABLE IF NOT EXISTS ledger_outbox (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN (
    'step_outcome', 'context_capture', 'spend_attribution', 'step_verification',
    'human_verdict_patch', 'interruption', 'gate_agreement_patch'
  )),
  dedupe_key   TEXT NOT NULL UNIQUE,
  payload      TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  not_before   TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at      TEXT,
  dead_at      TEXT,
  dead_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ledger_outbox_due ON ledger_outbox(sent_at, not_before);

CREATE TABLE IF NOT EXISTS alicorn_task_strategy (
  task_id                TEXT PRIMARY KEY,
  strategy               TEXT NOT NULL CHECK (strategy IN ('single', 'orchestrated')),
  source                 TEXT NOT NULL CHECK (source IN ('default', 'user', 'escalation')),
  escalation_offered_at  TEXT,
  escalation_accepted_at TEXT,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alicorn_dispatch_members (
  dispatch_id            TEXT PRIMARY KEY,
  member_id              TEXT NOT NULL,
  member_role            TEXT NOT NULL,
  backend                TEXT NOT NULL,
  review_backend_bypass  INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alicorn_correction_scans (
  worktree_id     TEXT PRIMARY KEY,
  last_scanned_at TEXT NOT NULL,
  last_commit     TEXT
);

-- Local mirror of the named check results a dispatch produced (GP1). The Ledger API is the
-- authority on verifications, but it is eventual and remote; a gate has to decide now, from disk.
-- Same key the ledger upserts on, so a re-run's verdict replaces the one it re-ran.
CREATE TABLE IF NOT EXISTS alicorn_dispatch_verifications (
  dispatch_id TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  required    INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped', 'error')),
  detail      TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (dispatch_id, kind, name)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_verifications_task
  ON alicorn_dispatch_verifications(task_id);

-- MR1: a task's feature workspace — the (repo, branch, worktree) tuples it spans.
-- Keyed by worktree, not repo: a folder workspace's repo id is folder-workspace:<projectGroupId>,
-- shared by every folder workspace in the group, so a repo key collapses a two-folder set into one.
-- The execution host is deliberately absent: a repo can be re-homed under a bound task, so the host
-- is resolved from the repo/worktree registry at use time rather than cached here and read stale.
CREATE TABLE IF NOT EXISTS alicorn_task_worktrees (
  task_id     TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  repo_id     TEXT NOT NULL,
  branch      TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  ordinal     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, worktree_id)
);

CREATE INDEX IF NOT EXISTS idx_task_worktrees_worktree
  ON alicorn_task_worktrees(worktree_id);

-- The structured Claude session a subject is worked in: one per subject, so reopening a ticket
-- (or a project's chat) reattaches to the conversation rather than starting a second one beside it.
-- subject_id is a task id, or project:<projectId> for a project chat.
CREATE TABLE IF NOT EXISTS alicorn_sessions (
  subject_id  TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  agent       TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_session
  ON alicorn_sessions(session_id);

CREATE TABLE IF NOT EXISTS alicorn_dispatch_ledger (
  dispatch_id    TEXT PRIMARY KEY,
  outcome_id     TEXT NOT NULL,
  files_modified TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
  `
}
