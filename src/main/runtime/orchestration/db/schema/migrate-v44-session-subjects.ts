import type { OrchestrationDb } from '../orchestration-db'

/**
 * A session belongs to a *subject*, and a task is only one kind.
 *
 * v43 keyed the table by `task_id` because a task was the only thing that had a session. The
 * project chat is a second one, and a column named `task_id` holding a project key is exactly the
 * overloading that makes the next reader mistrust the column.
 *
 * Copy-and-drop rather than `ALTER TABLE ... RENAME`: the create-tables pass runs before this one,
 * so the new table already exists by the time a migration could rename onto its name. Every v43
 * row is a task subject and stays one, under a name that is now honest.
 */
export function applySchemaMigrationV44(this: OrchestrationDb, current: number): void {
  if (current >= 44) {
    return
  }
  const hasLegacy = this.db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'alicorn_task_sessions'")
    .get()
  if (!hasLegacy) {
    return
  }
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS alicorn_sessions (
      subject_id  TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      agent       TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR REPLACE INTO alicorn_sessions (subject_id, session_id, agent, worktree_id, created_at)
      SELECT task_id, session_id, agent, worktree_id, created_at FROM alicorn_task_sessions;
    DROP TABLE alicorn_task_sessions;
    CREATE INDEX IF NOT EXISTS idx_sessions_session ON alicorn_sessions(session_id);
  `)
}
