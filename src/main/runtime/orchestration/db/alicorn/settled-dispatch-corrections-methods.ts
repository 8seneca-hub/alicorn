import type { OrchestrationDb } from '../orchestration-db'

type SettledDispatchForCorrectionsQueryRow = {
  dispatch_id: string
  task_id: string
  dispatched_at: string | null
  completed_at: string
  worktree_id: string | null
}

export type SettledDispatchForCorrections = {
  dispatchId: string
  taskId: string
  dispatchedAt: string | null
  completedAt: string
  worktreeId: string | null
}

// Why no filesModified here: ledger_outbox is a transport queue the drainer alone reads back,
// never a data store. filesModified comes from alicorn_dispatch_ledger (db.getDispatchLedgerEntry).
/** Settled (completed or failed) dispatches with their worktree, for the corrections sweep. */
export function listSettledDispatchesForCorrections(
  this: OrchestrationDb,
  sinceUtc: string
): SettledDispatchForCorrections[] {
  const rows = this.db
    .prepare(
      `SELECT dc.id AS dispatch_id, dc.task_id, dc.dispatched_at, dc.completed_at, wd.worktree_id
       FROM dispatch_contexts dc
       JOIN worker_dispatches wd ON wd.dispatch_id = dc.id
       WHERE dc.status IN ('completed', 'failed') AND dc.completed_at >= ?
       ORDER BY dc.completed_at ASC`
    )
    .all(sinceUtc) as SettledDispatchForCorrectionsQueryRow[]
  return rows.map((row) => ({
    dispatchId: row.dispatch_id,
    taskId: row.task_id,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at,
    worktreeId: row.worktree_id
  }))
}

export type SettledDispatchCorrectionsMethods = {
  listSettledDispatchesForCorrections: typeof listSettledDispatchesForCorrections
}

export function attachSettledDispatchCorrectionsMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    listSettledDispatchesForCorrections
  })
}
