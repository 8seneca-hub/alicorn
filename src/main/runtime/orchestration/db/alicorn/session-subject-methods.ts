import type { OrchestrationDb } from '../orchestration-db'
import type { TaskSessionBinding } from '../../../../../shared/alicorn/task-session'

type AlicornSessionRow = {
  session_id: string
  agent: string
  worktree_id: string
}

// Explicit column list, never `SELECT *`: sync-database refuses to cache a statement containing
// a star.
const SESSION_COLUMNS = 'session_id, agent, worktree_id'

/**
 * Remembers which session is this subject's — a task, or a project's chat.
 *
 * Replace, not insert: a session that was closed leaves the subject needing a new one, and the
 * subject is still the same ticket. The worktree is recorded alongside because a session id alone
 * cannot be resolved back to the workspace it runs in.
 */
export function setSubjectSession(
  this: OrchestrationDb,
  subjectId: string,
  binding: TaskSessionBinding
): TaskSessionBinding {
  this.db
    .prepare(
      `INSERT INTO alicorn_sessions (subject_id, session_id, agent, worktree_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(subject_id) DO UPDATE SET
         session_id = excluded.session_id,
         agent = excluded.agent,
         worktree_id = excluded.worktree_id,
         created_at = datetime('now')`
    )
    .run(subjectId, binding.sessionId, binding.agent, binding.worktreeId)
  return binding
}

/** Null for a subject nobody has started, which is most of them. */
export function getSubjectSession(
  this: OrchestrationDb,
  subjectId: string
): TaskSessionBinding | null {
  const row = this.db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM alicorn_sessions WHERE subject_id = ?`)
    .get(subjectId) as AlicornSessionRow | undefined
  return row ? { sessionId: row.session_id, agent: row.agent, worktreeId: row.worktree_id } : null
}

export type SessionSubjectMethods = {
  setSubjectSession: typeof setSubjectSession
  getSubjectSession: typeof getSubjectSession
}

export function attachSessionSubjectMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    setSubjectSession,
    getSubjectSession
  })
}
