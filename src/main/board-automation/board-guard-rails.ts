import type { BoardTransitionRow } from '../runtime/orchestration/db/alicorn/alicorn-rows'
import { parseSqliteUtc } from '../alicorn/run-usage-attribution'

// Why these numbers: a dispatched agent costs real tokens, so the ceiling is deliberately low —
// three automated dispatches an hour for one workspace is already more than a human would trigger.
export const BOARD_DISPATCH_CEILING = { max: 3, windowMs: 3_600_000 }

export const BOARD_LOOP_WINDOW_MS = 86_400_000

/**
 * How many earlier automated dispatches into the *same* column are tolerated inside the loop window
 * before the next one is refused as a loop.
 *
 * 1 allows exactly one correction cycle — build → review → (findings) → build → review — which is
 * the return edge the product treats as first-class, while still refusing a column that keeps
 * re-dispatching itself. At 0 the second visit to any column is refused, which would block that
 * flow at its first iteration.
 */
export const BOARD_LOOP_MAX_REVISITS = 1

export type GuardVerdict =
  | { allow: true }
  | { allow: false; reason: 'ceiling' | 'loop' | 'killed'; detail: string }

export type BoardGuardInput = {
  now: number
  /** This worktree's recent transitions, ascending. */
  transitions: readonly BoardTransitionRow[]
  toStatusId: string
  killed: boolean
}

/**
 * Rows arrive from SQLite as `YYYY-MM-DD HH:MM:SS` in UTC, which `Date.parse` reads as *local*
 * time — seven hours early in UTC+7, which pushed every row outside the one-hour window and stopped
 * the ceiling firing at all. Parse the SQLite shape first, and accept ISO for callers that build
 * rows themselves.
 */
function transitionTimeMs(createdAt: string): number | null {
  const sqlite = parseSqliteUtc(createdAt)
  if (sqlite !== null) {
    return sqlite
  }
  const iso = Date.parse(createdAt)
  return Number.isNaN(iso) ? null : iso
}

function dispatchedSince(
  transitions: readonly BoardTransitionRow[],
  since: number
): BoardTransitionRow[] {
  return transitions.filter((row) => {
    if (row.outcome !== 'dispatched') {
      return false
    }
    const at = transitionTimeMs(row.createdAt)
    // Why: an unparseable timestamp is not silently treated as "long ago" — that would let a bad row
    // widen the window and defeat the ceiling.
    return at === null ? true : at >= since
  })
}

/**
 * Decides whether a column transition may dispatch.
 *
 * Order matters: the kill switch wins over everything, because a human turning automation off must
 * not be second-guessed by a budget that happens to have room. The ceiling is checked before the
 * loop so runaway spend is refused for the reason that actually stopped it.
 */
export function evaluateBoardGuard(input: BoardGuardInput): GuardVerdict {
  if (input.killed) {
    return { allow: false, reason: 'killed', detail: 'Board automation is switched off.' }
  }

  const recent = dispatchedSince(input.transitions, input.now - BOARD_DISPATCH_CEILING.windowMs)
  if (recent.length >= BOARD_DISPATCH_CEILING.max) {
    const minutes = Math.round(BOARD_DISPATCH_CEILING.windowMs / 60_000)
    return {
      allow: false,
      reason: 'ceiling',
      detail: `${recent.length} automated dispatches in the last ${minutes} minutes reached the ceiling of ${BOARD_DISPATCH_CEILING.max}.`
    }
  }

  const revisits = dispatchedSince(input.transitions, input.now - BOARD_LOOP_WINDOW_MS).filter(
    (row) => row.toStatusId === input.toStatusId
  )
  if (revisits.length > BOARD_LOOP_MAX_REVISITS) {
    const hours = Math.round(BOARD_LOOP_WINDOW_MS / 3_600_000)
    return {
      allow: false,
      reason: 'loop',
      detail: `This workspace already entered ${input.toStatusId} ${revisits.length} times in the last ${hours} hours.`
    }
  }

  return { allow: true }
}
