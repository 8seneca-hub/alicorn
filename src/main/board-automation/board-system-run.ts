import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { RunRow } from '../runtime/orchestration/types'

// Why a synthetic handle and pane key: a board has no terminal and no pane, but a Run needs a
// coordinator. Namespacing by repo keeps one board's Run from unbinding another's, and keeps these
// rows from ever colliding with a real pane key.
export function boardCoordinatorHandle(repoId: string): string {
  return `board:${repoId}`
}

/**
 * The Run every automated dispatch for a repo belongs to, created once.
 *
 * Automation dispatches through the ordinary task/dispatch path precisely so its runs carry the
 * same provenance as a human's; that requires a Run, and a board has none of its own.
 */
export function ensureBoardRun(db: OrchestrationDb, repoId: string): RunRow {
  const handle = boardCoordinatorHandle(repoId)
  const existing = db
    .listRuns()
    .runs.find((run) => run.coordinator_handle === handle && run.legacy === 0)
  if (existing) {
    return existing
  }
  return db.createRun({
    objective: `Board automation for ${repoId}`,
    coordinatorHandle: handle,
    coordinatorPaneKey: handle
  })
}
