import type { OrchestrationDb } from '../orchestration-db'
import type { RunDispatchRow } from './alicorn-rows'

type RunDispatchQueryRow = {
  dispatch_id: string
  task_id: string
  worktree_id: string | null
  start_options: string
  member_backend: string | null
  dispatched_at: string | null
  completed_at: string | null
}

/**
 * Every worker dispatch under a run, across all of its tasks.
 *
 * Scoped through `tasks.run_id` rather than `dispatch_contexts.run_id` because the run is a
 * property of the task graph; a dispatch inherits it. BR1 accumulates a blast-radius budget over
 * exactly this set: a per-task count is laundered by splitting one change into five tasks, which
 * is the attack the budget exists to stop.
 *
 * Same joins `listActiveOrRecentlyCompletedDispatches` uses, so backend resolution matches.
 */
export function listRunDispatches(this: OrchestrationDb, runId: string): RunDispatchRow[] {
  const rows = this.db
    .prepare(
      `SELECT dc.id AS dispatch_id, t.id AS task_id, dc.dispatched_at, dc.completed_at,
              wd.worktree_id, wd.start_options,
              adm.backend AS member_backend
       FROM tasks t
       JOIN dispatch_contexts dc ON dc.task_id = t.id
       JOIN worker_dispatches wd ON wd.dispatch_id = dc.id
       LEFT JOIN alicorn_dispatch_members adm ON adm.dispatch_id = dc.id
       WHERE t.run_id = ?
       ORDER BY dc.created_at, dc.id`
    )
    .all(runId) as RunDispatchQueryRow[]
  return rows.map((row) => ({
    dispatchId: row.dispatch_id,
    taskId: row.task_id,
    worktreeId: row.worktree_id,
    startOptions: row.start_options,
    memberBackend: row.member_backend,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at
  }))
}

export type RunDispatchMethods = {
  listRunDispatches: typeof listRunDispatches
}

export function attachRunDispatchMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, { listRunDispatches })
}
