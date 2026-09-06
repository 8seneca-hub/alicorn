import type { OrchestrationDb } from '../orchestration-db'
import type { ActiveOrRecentDispatchRow } from './alicorn-rows'

type ActiveOrRecentDispatchQueryRow = {
  dispatch_id: string
  worktree_id: string | null
  start_options: string
  member_backend: string | null
  dispatched_at: string | null
  completed_at: string | null
}

/** Dispatches a cost publisher on a timer should still be pricing: live ('dispatched')
 *  or settled inside the given UTC window. Joins the same tables step-outcome-builder
 *  reads (worker_dispatches, alicorn_dispatch_members) so backend resolution matches. */
export function listActiveOrRecentlyCompletedDispatches(
  this: OrchestrationDb,
  completedSinceUtc: string
): ActiveOrRecentDispatchRow[] {
  const rows = this.db
    .prepare(
      `SELECT dc.id AS dispatch_id, dc.dispatched_at, dc.completed_at,
              wd.worktree_id, wd.start_options,
              adm.backend AS member_backend
       FROM dispatch_contexts dc
       JOIN worker_dispatches wd ON wd.dispatch_id = dc.id
       LEFT JOIN alicorn_dispatch_members adm ON adm.dispatch_id = dc.id
       WHERE dc.status = 'dispatched'
          OR (dc.status = 'completed' AND dc.completed_at >= ?)`
    )
    .all(completedSinceUtc) as ActiveOrRecentDispatchQueryRow[]
  return rows.map((row) => ({
    dispatchId: row.dispatch_id,
    worktreeId: row.worktree_id,
    startOptions: row.start_options,
    memberBackend: row.member_backend,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at
  }))
}

export type ActiveOrRecentDispatchMethods = {
  listActiveOrRecentlyCompletedDispatches: typeof listActiveOrRecentlyCompletedDispatches
}

export function attachActiveOrRecentDispatchMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    listActiveOrRecentlyCompletedDispatches
  })
}
