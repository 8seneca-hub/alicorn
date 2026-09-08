import type { OrchestrationDb } from '../orchestration-db'

// MR1: additive only. An existing DB has no multi-repo tasks, so there is nothing to backfill —
// a single-repo task keeps resolving through the scalar worktree it always did, and the absence
// of rows here reads as "not a feature workspace" everywhere it is consulted.
export function applySchemaMigrationV39(this: OrchestrationDb, current: number): void {
  if (current < 39) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alicorn_task_worktrees (
        task_id     TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        repo_id     TEXT NOT NULL,
        branch      TEXT,
        is_primary  INTEGER NOT NULL DEFAULT 0,
        ordinal     INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (task_id, worktree_id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_worktrees_worktree
        ON alicorn_task_worktrees(worktree_id);
    `)
  }
}
