import type { OrchestrationDb } from '../orchestration-db'

// Why: SQLite has no ADD COLUMN IF NOT EXISTS; hasColumn guards a re-run on a half-migrated DB.
export function applySchemaMigrationV37(this: OrchestrationDb, current: number): void {
  if (current < 37) {
    if (!this.hasColumn('ledger_outbox', 'dead_at')) {
      this.db.exec('ALTER TABLE ledger_outbox ADD COLUMN dead_at TEXT')
    }
    if (!this.hasColumn('ledger_outbox', 'dead_reason')) {
      this.db.exec('ALTER TABLE ledger_outbox ADD COLUMN dead_reason TEXT')
    }
  }
}
