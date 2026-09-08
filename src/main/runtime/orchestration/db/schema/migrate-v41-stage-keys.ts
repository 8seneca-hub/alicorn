import type { OrchestrationDb } from '../orchestration-db'

// SK1: additive columns on `decision_gates` only — nothing is backfilled.
//
// Why no backfill of `stage_key`: a gate written before this migration was evaluated under a
// free-text key that may or may not have been a stage, and inventing one now would put invented
// rows into the very window that decides whether a gate may retire. Null reads as "not recorded",
// which is the truth, and every gate opened from here on carries the canonical key.
export function applySchemaMigrationV41(this: OrchestrationDb, current: number): void {
  if (current < 41) {
    // Why hasColumn: SQLite has no ADD COLUMN IF NOT EXISTS, and a half-migrated DB re-runs this.
    for (const column of ['stage_key TEXT', 'retired_at TEXT', 'retirement_refusal TEXT']) {
      const name = column.split(' ')[0]
      if (!this.hasColumn('decision_gates', name)) {
        this.db.exec(`ALTER TABLE decision_gates ADD COLUMN ${column}`)
      }
    }
    // A retired gate must be cheap to exclude from the interruption sweep, which scans a task's
    // gates by created_at on every settlement.
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_gates_task_retired ON decision_gates(task_id, retired_at)'
    )
  }
}
