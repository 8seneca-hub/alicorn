import type { OrchestrationDb } from '../orchestration-db'

// Why: SQLite can't ALTER a CHECK, so ledger_outbox is rebuilt to accept
// 'human_verdict_patch' and 'interruption' — the corrections watcher and
// interruption capture kinds.
export function applySchemaMigrationV33(this: OrchestrationDb, current: number): void {
  if (current < 33) {
    this.db.exec(`
      CREATE TABLE ledger_outbox_new (
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
      INSERT INTO ledger_outbox_new
        (id, kind, dedupe_key, payload, attempts, not_before, last_error, created_at, sent_at)
      SELECT id, kind, dedupe_key, payload, attempts, not_before, last_error, created_at, sent_at
      FROM ledger_outbox;
      DROP TABLE ledger_outbox;
      ALTER TABLE ledger_outbox_new RENAME TO ledger_outbox;
      CREATE INDEX IF NOT EXISTS idx_ledger_outbox_due ON ledger_outbox(sent_at, not_before);

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
    `)
  }
}
