import type { OrchestrationDb } from '../../runtime/orchestration/db'

type DispatchOrderRow = {
  task_id: string
  id: string
  dispatched_at: string | null
  completed_at: string | null
  status: string
}

export type ReopenedTask = {
  priorDispatchId: string
  newDispatchedAt: string
  priorCompletedAt: string
}

/**
 * Plan decision 3: a task's latest settled dispatch succeeded, then a new dispatch was
 * created for it. Dispatches for a task never overlap (worker-report-settlement guards
 * that), so the immediate predecessor in dispatched_at order is "the latest settled dispatch".
 */
export function detectReopenedTasks(db: OrchestrationDb, sinceUtc: string): ReopenedTask[] {
  const rows = db.db
    .prepare(
      `SELECT task_id, id, dispatched_at, completed_at, status
       FROM dispatch_contexts
       WHERE dispatched_at IS NOT NULL
         AND task_id IN (SELECT DISTINCT task_id FROM dispatch_contexts WHERE dispatched_at >= ?)
       ORDER BY task_id, dispatched_at ASC, rowid ASC`
    )
    .all(sinceUtc) as DispatchOrderRow[]

  const results: ReopenedTask[] = []
  let previous: DispatchOrderRow | null = null
  for (const row of rows) {
    if (
      previous &&
      previous.task_id === row.task_id &&
      previous.status === 'completed' &&
      previous.completed_at !== null &&
      row.dispatched_at! >= sinceUtc
    ) {
      results.push({
        priorDispatchId: previous.id,
        newDispatchedAt: row.dispatched_at!,
        priorCompletedAt: previous.completed_at
      })
    }
    previous = row
  }
  return results
}
