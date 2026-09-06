import type { OrchestrationDb } from '../orchestration-db'

// Why: the run-cost publisher scans dispatch_contexts for 'completed' rows inside a
// 24h window every 60s; idx_dispatch_status alone can't narrow that, so it would
// scan every completed dispatch ever, and the table is never pruned.
export function applySchemaMigrationV32(this: OrchestrationDb, current: number): void {
  if (current < 32) {
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_dispatch_status_completed_at ON dispatch_contexts(status, completed_at)'
    )
  }
}
