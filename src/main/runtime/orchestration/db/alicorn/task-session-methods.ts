import type { OrchestrationDb } from '../orchestration-db'
import type { TaskSessionBinding } from '../../../../../shared/alicorn/task-session'

type AlicornTaskSessionRow = {
  session_id: string
  agent: string
  worktree_id: string
}

// Explicit column list, never `SELECT *`: sync-database refuses to cache a statement containing
// a star.
const TASK_SESSION_COLUMNS = 'session_id, agent, worktree_id'

/**
 * Remembers which session is this task's.
 *
 * Replace, not insert: a session that was closed leaves the task needing a new one, and the task
 * is still the same ticket. The worktree is recorded alongside because a session id alone cannot
 * be resolved back to the workspace it runs in.
 */
export function setTaskSession(
  this: OrchestrationDb,
  taskId: string,
  binding: TaskSessionBinding
): TaskSessionBinding {
  this.db
    .prepare(
      `INSERT INTO alicorn_task_sessions (task_id, session_id, agent, worktree_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         session_id = excluded.session_id,
         agent = excluded.agent,
         worktree_id = excluded.worktree_id,
         created_at = datetime('now')`
    )
    .run(taskId, binding.sessionId, binding.agent, binding.worktreeId)
  return binding
}

/** Null for a task nobody has started, which is most of them. */
export function getTaskSession(this: OrchestrationDb, taskId: string): TaskSessionBinding | null {
  const row = this.db
    .prepare(`SELECT ${TASK_SESSION_COLUMNS} FROM alicorn_task_sessions WHERE task_id = ?`)
    .get(taskId) as AlicornTaskSessionRow | undefined
  return row ? { sessionId: row.session_id, agent: row.agent, worktreeId: row.worktree_id } : null
}

export type TaskSessionMethods = {
  setTaskSession: typeof setTaskSession
  getTaskSession: typeof getTaskSession
}

export function attachTaskSessionMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    setTaskSession,
    getTaskSession
  })
}
