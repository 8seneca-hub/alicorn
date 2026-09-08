import type { OrchestrationDb } from '../orchestration-db'

// Why: SQLite has no ADD COLUMN IF NOT EXISTS; hasColumn guards a re-run on a half-migrated DB.
export function applySchemaMigrationV38(this: OrchestrationDb, current: number): void {
  if (current < 38) {
    if (!this.hasColumn('decision_gates', 'recommended_decision')) {
      this.db.exec('ALTER TABLE decision_gates ADD COLUMN recommended_decision TEXT')
    }
    if (!this.hasColumn('decision_gates', 'recommended_reason')) {
      this.db.exec('ALTER TABLE decision_gates ADD COLUMN recommended_reason TEXT')
    }
    // Why no CHECK on the added columns: SQLite cannot add one to an existing table, and the
    // fresh-install DDL already carries it. The writer is the only path in either case.
    this.db.exec(`
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
    `)
  }
}
