import type { OrchestrationDb } from '../orchestration-db'

// Why a rebuild: SQLite cannot ALTER a CHECK, so ledger_outbox is recreated to accept
// 'gate_agreement_patch' (GP3). Same shape as v33's rebuild, plus v37's dead-letter columns —
// dropping those here would silently un-migrate a database that already has them.
export function applySchemaMigrationV40(this: OrchestrationDb, current: number): void {
  if (current < 40) {
    // Why hasColumn: SQLite has no ADD COLUMN IF NOT EXISTS, and a half-migrated DB re-runs this.
    if (!this.hasColumn('decision_gates', 'recommended_level')) {
      this.db.exec('ALTER TABLE decision_gates ADD COLUMN recommended_level INTEGER')
    }
    this.db.exec(`
      CREATE TABLE ledger_outbox_new (
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
      INSERT INTO ledger_outbox_new
        (id, kind, dedupe_key, payload, attempts, not_before, last_error, created_at, sent_at,
         dead_at, dead_reason)
      SELECT id, kind, dedupe_key, payload, attempts, not_before, last_error, created_at, sent_at,
             dead_at, dead_reason
      FROM ledger_outbox;
      DROP TABLE ledger_outbox;
      ALTER TABLE ledger_outbox_new RENAME TO ledger_outbox;
      CREATE INDEX IF NOT EXISTS idx_ledger_outbox_due ON ledger_outbox(sent_at, not_before);
    `)
  }
}
