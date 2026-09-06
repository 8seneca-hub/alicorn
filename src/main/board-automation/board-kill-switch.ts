import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { BoardTransitionRow } from '../runtime/orchestration/db/alicorn/alicorn-rows'
import { boardCoordinatorHandle } from './board-system-run'

export const BOARD_KILL_SCOPE_GLOBAL = 'global'

export function boardKillScope(repoId: string): string {
  return boardCoordinatorHandle(repoId)
}

export type BoardAutomationStatus = {
  /** Effective answer for this repo: either scope being off means off. */
  killed: boolean
  globalDisabledAt: string | null
  globalDisabledBy: string | null
  boardDisabledAt: string | null
  boardDisabledBy: string | null
  /** Most recent refusal for this repo, so the switch can say why nothing ran. */
  lastRefusal: { outcome: BoardTransitionRow['outcome']; at: string; toStatusId: string } | null
}

/**
 * Whether automation is off for a repo.
 *
 * Either scope disables: a global stop must not be defeated by a board that was never
 * individually disabled, and a board stop must hold while the rest of the machine runs.
 */
export function isBoardAutomationKilled(db: OrchestrationDb, repoId: string): boolean {
  return (
    db.getBoardAutomationState(BOARD_KILL_SCOPE_GLOBAL).disabledAt !== null ||
    db.getBoardAutomationState(boardKillScope(repoId)).disabledAt !== null
  )
}

// Why `by`: a stop that nobody owns is hard to lift with confidence months later.
export function setBoardAutomationKilled(
  db: OrchestrationDb,
  scope: string,
  by: string | null
): void {
  db.setBoardAutomationDisabled(scope, by)
}

/**
 * What the switch shows: both scopes, and the last refusal.
 *
 * The refusal is read per repo across recent history rather than per workspace, because the
 * question the header answers is "why is nothing happening on this board?".
 */
export function getBoardAutomationStatus(
  db: OrchestrationDb,
  repoId: string,
  opts: { lastRefusalSinceMs: number }
): BoardAutomationStatus {
  const global = db.getBoardAutomationState(BOARD_KILL_SCOPE_GLOBAL)
  const board = db.getBoardAutomationState(boardKillScope(repoId))
  const refusals = db
    .listBoardTransitionsForRepo(repoId, opts.lastRefusalSinceMs)
    .filter((row) => row.outcome !== 'dispatched')
  const last = refusals.at(-1) ?? null
  return {
    killed: global.disabledAt !== null || board.disabledAt !== null,
    globalDisabledAt: global.disabledAt,
    globalDisabledBy: global.disabledBy,
    boardDisabledAt: board.disabledAt,
    boardDisabledBy: board.disabledBy,
    lastRefusal: last
      ? { outcome: last.outcome, at: last.createdAt, toStatusId: last.toStatusId }
      : null
  }
}
