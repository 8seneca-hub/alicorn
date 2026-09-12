import type { OrchestrationDb } from '../orchestration-db'

// A task's Claude session. Additive: a task with no row has simply never been started, which is
// what every task in an existing DB is.
export function applySchemaMigrationV43(this: OrchestrationDb, current: number): void {
  if (current < 43) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alicorn_task_sessions (
        task_id     TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        agent       TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_task_sessions_session
        ON alicorn_task_sessions(session_id);
    `)
  }
}
