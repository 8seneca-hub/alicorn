import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type {
  BoardAutomationStateRow,
  BoardTransitionOutcome,
  BoardTransitionRow
} from './alicorn-rows'

type AlicornBoardTransitionRow = {
  id: string
  repo_id: string
  worktree_id: string
  task_id: string | null
  dispatch_id: string | null
  from_status_id: string | null
  to_status_id: string
  rule_id: string
  outcome: BoardTransitionOutcome
  created_at: string
}

function toBoardTransition(row: AlicornBoardTransitionRow): BoardTransitionRow {
  return {
    id: row.id,
    repoId: row.repo_id,
    worktreeId: row.worktree_id,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    fromStatusId: row.from_status_id,
    toStatusId: row.to_status_id,
    ruleId: row.rule_id,
    outcome: row.outcome,
    createdAt: row.created_at
  }
}

export function recordBoardTransition(
  this: OrchestrationDb,
  row: {
    repoId: string
    worktreeId: string
    toStatusId: string
    ruleId: string
    outcome: BoardTransitionOutcome
    fromStatusId?: string | null
    taskId?: string | null
    dispatchId?: string | null
  }
): string {
  const id = generateId('bt')
  this.db
    .prepare(
      `INSERT INTO alicorn_board_transitions
         (id, repo_id, worktree_id, task_id, dispatch_id, from_status_id, to_status_id, rule_id, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      row.repoId,
      row.worktreeId,
      row.taskId ?? null,
      row.dispatchId ?? null,
      row.fromStatusId ?? null,
      row.toStatusId,
      row.ruleId,
      row.outcome,
      nowSqliteUtcTextMs()
    )
  return id
}

/**
 * SQLite writes `datetime('now')` as `YYYY-MM-DD HH:MM:SS` in UTC. The bound has to be in the same
 * text shape, because the comparison below is a string comparison: an ISO bound would put `T`
 * (0x54) against the stored space (0x20) and silently exclude every row from the same day.
 */
function toSqliteUtcText(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

/**
 * Written with millisecond precision, unlike the column's second-resolution `datetime('now')`
 * default, so the stored time is accurate to what happened.
 *
 * Precision alone is not enough to order by, though: two transitions can land in the same
 * millisecond, and the generated id is random. Both listings therefore tie-break on `rowid`, which
 * is insertion order. A lower bound at second precision still compares correctly against these
 * values, because '…:00' sorts below '…:00.123'.
 */
function nowSqliteUtcTextMs(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '')
}

// Why ms rather than a formatted string: the caller cannot then pass a shape that compares wrong.
// Ascending, so the loop detector reads a worktree's moves forwards in time and the ceiling counts
// a window without re-sorting.
export function listBoardTransitions(
  this: OrchestrationDb,
  worktreeId: string,
  sinceMs: number
): BoardTransitionRow[] {
  const rows = this.db
    .prepare(
      `SELECT * FROM alicorn_board_transitions
       WHERE worktree_id = ? AND created_at >= ?
       ORDER BY created_at, rowid`
    )
    .all(worktreeId, toSqliteUtcText(sinceMs)) as AlicornBoardTransitionRow[]
  return rows.map(toBoardTransition)
}

// Why a repo-scoped read as well: the kill switch answers "why is nothing happening on this
// board?", which is a repo question, not a workspace one.
export function listBoardTransitionsForRepo(
  this: OrchestrationDb,
  repoId: string,
  sinceMs: number
): BoardTransitionRow[] {
  const rows = this.db
    .prepare(
      `SELECT * FROM alicorn_board_transitions
       WHERE repo_id = ? AND created_at >= ?
       ORDER BY created_at, rowid`
    )
    .all(repoId, toSqliteUtcText(sinceMs)) as AlicornBoardTransitionRow[]
  return rows.map(toBoardTransition)
}

// Why: an absent row reads as enabled. Automation must not need a row to run, or a fresh install
// would look disabled and nothing would dispatch.
export function getBoardAutomationState(
  this: OrchestrationDb,
  scope: string
): BoardAutomationStateRow {
  const row = this.db
    .prepare('SELECT * FROM alicorn_board_automation_state WHERE scope = ?')
    .get(scope) as
    | { scope: string; disabled_at: string | null; disabled_by: string | null }
    | undefined
  return {
    scope,
    disabledAt: row?.disabled_at ?? null,
    disabledBy: row?.disabled_by ?? null
  }
}

/**
 * Disables or re-enables one scope (`global`, or `board:<repoId>`).
 *
 * Re-enabling deletes the row rather than blanking it, so "enabled" has exactly one
 * representation and `getBoardAutomationState` cannot disagree with itself. A repeated disable
 * keeps the original `disabled_at` — the first stop is when automation actually stopped.
 */
export function setBoardAutomationDisabled(
  this: OrchestrationDb,
  scope: string,
  disabledBy: string | null
): void {
  if (disabledBy === null) {
    this.db.prepare('DELETE FROM alicorn_board_automation_state WHERE scope = ?').run(scope)
    return
  }
  this.db
    .prepare(
      `INSERT INTO alicorn_board_automation_state (scope, disabled_at, disabled_by)
       VALUES (?, datetime('now'), ?)
       ON CONFLICT(scope) DO UPDATE SET disabled_by = excluded.disabled_by`
    )
    .run(scope, disabledBy)
}

export type BoardTransitionMethods = {
  recordBoardTransition: typeof recordBoardTransition
  listBoardTransitions: typeof listBoardTransitions
  listBoardTransitionsForRepo: typeof listBoardTransitionsForRepo
  getBoardAutomationState: typeof getBoardAutomationState
  setBoardAutomationDisabled: typeof setBoardAutomationDisabled
}

export function attachBoardTransitionMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    recordBoardTransition,
    listBoardTransitions,
    listBoardTransitionsForRepo,
    getBoardAutomationState,
    setBoardAutomationDisabled
  })
}
