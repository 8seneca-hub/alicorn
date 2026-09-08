import {
  normalizeTaskWorktreeTuples,
  type TaskWorktreeTuple,
  type TaskWorktreeTupleInput
} from '../../../../../shared/alicorn/feature-workspace-tuples'
import type { OrchestrationDb } from '../orchestration-db'

type AlicornTaskWorktreeRow = {
  worktree_id: string
  repo_id: string
  branch: string | null
  is_primary: number
}

// Explicit column list, never `SELECT *`: sync-database refuses to cache a statement containing
// a star, so a star here costs a re-prepare on every read.
const TASK_WORKTREE_COLUMNS = 'worktree_id, repo_id, branch, is_primary'

function toTuple(row: AlicornTaskWorktreeRow): TaskWorktreeTuple {
  return {
    repoId: row.repo_id,
    worktreeId: row.worktree_id,
    branch: row.branch,
    primary: row.is_primary === 1
  }
}

/**
 * Replaces a task's whole feature workspace in one transaction.
 *
 * Whole-set replace, not per-tuple upsert: `primary` and `ordinal` are properties of the set, so a
 * partial write can leave two primaries or none, and every reader (dispatch resolution, the
 * preamble, the PR body) assumes exactly one. An empty array unbinds the task, which reads
 * everywhere as "not a feature workspace" — the pre-MR1 shape.
 */
export function setTaskWorktrees(
  this: OrchestrationDb,
  taskId: string,
  tuples: readonly TaskWorktreeTupleInput[]
): TaskWorktreeTuple[] {
  const normalized = normalizeTaskWorktreeTuples(tuples)
  this.db.exec('BEGIN IMMEDIATE')
  try {
    this.db.prepare('DELETE FROM alicorn_task_worktrees WHERE task_id = ?').run(taskId)
    const insert = this.db.prepare(
      `INSERT INTO alicorn_task_worktrees
         (task_id, worktree_id, repo_id, branch, is_primary, ordinal)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    normalized.forEach((tuple, index) => {
      insert.run(taskId, tuple.worktreeId, tuple.repoId, tuple.branch, tuple.primary ? 1 : 0, index)
    })
    this.db.exec('COMMIT')
  } catch (err) {
    this.db.exec('ROLLBACK')
    throw err
  }
  return normalized
}

/** Empty for every task that predates MR1 or binds one workspace the old way. */
export function listTaskWorktrees(this: OrchestrationDb, taskId: string): TaskWorktreeTuple[] {
  const rows = this.db
    .prepare(
      `SELECT ${TASK_WORKTREE_COLUMNS} FROM alicorn_task_worktrees
       WHERE task_id = ? ORDER BY ordinal`
    )
    .all(taskId) as AlicornTaskWorktreeRow[]
  return rows.map(toTuple)
}

/** MR2 reads this without loading the set: a task on more than one repo may want a lead. */
export function countTaskRepos(this: OrchestrationDb, taskId: string): number {
  const row = this.db
    .prepare('SELECT COUNT(DISTINCT repo_id) AS n FROM alicorn_task_worktrees WHERE task_id = ?')
    .get(taskId) as { n: number } | undefined
  return row?.n ?? 0
}

export type TaskWorktreeMethods = {
  setTaskWorktrees: typeof setTaskWorktrees
  listTaskWorktrees: typeof listTaskWorktrees
  countTaskRepos: typeof countTaskRepos
}

export function attachTaskWorktreeMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    setTaskWorktrees,
    listTaskWorktrees,
    countTaskRepos
  })
}
