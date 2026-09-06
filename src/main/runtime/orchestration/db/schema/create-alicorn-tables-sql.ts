export function createAlicornTablesSql(): string {
  return `
CREATE TABLE IF NOT EXISTS ledger_outbox (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN (
    'step_outcome', 'context_capture', 'spend_attribution', 'step_verification',
    'human_verdict_patch', 'interruption'
  )),
  dedupe_key   TEXT NOT NULL UNIQUE,
  payload      TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  not_before   TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at      TEXT
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

CREATE TABLE IF NOT EXISTS alicorn_dispatch_ledger (
  dispatch_id TEXT PRIMARY KEY,
  outcome_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
  `
}
