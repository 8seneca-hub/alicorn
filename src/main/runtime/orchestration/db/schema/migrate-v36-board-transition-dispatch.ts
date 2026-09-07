import type { OrchestrationDb } from '../orchestration-db'

// Why: the step-outcome builder looks a board transition up by dispatch id on every settled
// dispatch, and the only existing index is on (worktree_id, created_at). Without this the lookup
// scans a table that is never pruned, on a path that runs for non-board dispatches too.
export function applySchemaMigrationV36(this: OrchestrationDb, current: number): void {
  if (current < 36) {
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_board_transitions_dispatch ON alicorn_board_transitions(dispatch_id)'
    )
  }
}
