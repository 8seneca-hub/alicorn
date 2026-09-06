import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { backendFromWorkerStartOptions } from './backend-from-start-options'

type TaskDepsRow = { deps: string }
type DispatchIdRow = { id: string }

function readDeps(db: OrchestrationDb, taskId: string): string[] {
  const row = db.db.prepare('SELECT deps FROM tasks WHERE id = ?').get(taskId) as
    | TaskDepsRow
    | undefined
  if (!row?.deps) {
    return []
  }
  try {
    const parsed = JSON.parse(row.deps) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((dep): dep is string => typeof dep === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * Which backends authored the work this task depends on.
 *
 * Only `completed` dispatches count: work still in flight has not authored
 * anything a reviewer could be judging. A dispatch launched as a member reports
 * that member's backend; one launched directly falls back to its start options.
 * `other` is ignored — an unclassified agent cannot be shown to conflict.
 */
export function getAuthorBackendsForTask(db: OrchestrationDb, taskId: string): Set<string> {
  const backends = new Set<string>()
  for (const depTaskId of readDeps(db, taskId)) {
    const dispatches = db.db
      .prepare("SELECT id FROM dispatch_contexts WHERE task_id = ? AND status = 'completed'")
      .all(depTaskId) as DispatchIdRow[]
    for (const dispatch of dispatches) {
      const backend =
        db.getDispatchMember(dispatch.id)?.backend ??
        backendFromWorkerStartOptions(db.getWorkerDispatch(dispatch.id)?.start_options)
      if (backend && backend !== 'other') {
        backends.add(backend)
      }
    }
  }
  return backends
}
