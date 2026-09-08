import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { RunDispatchRow } from '../../runtime/orchestration/db/alicorn/alicorn-rows'

/**
 * What a run has cost and how far it has reached, accumulated over the whole run (BR1).
 *
 * The boundary is the **run**, not the task, and that is the entire point of the ticket: a budget
 * counted per task is defeated by splitting one change into five, which is the cheapest thing an
 * agent can do. Files are the union of every worktree the run's dispatches touched; spend is the
 * sum over those dispatches.
 *
 * Every field is nullable because "we could not measure it" is a real answer — an SSH worktree
 * this host cannot see, a folder workspace that is not a repository, a backend Alicorn does not
 * price — and `evaluateGate` turns each null into a gate rather than a pass.
 */
export type RunBlastRadius = {
  filesChanged: number | null
  spendCents: number | null
  /** Repo-relative paths behind `filesChanged`, for the protected-path match. */
  changedPaths: string[] | null
}

export const UNMEASURED_RUN_BLAST_RADIUS: RunBlastRadius = {
  filesChanged: null,
  spendCents: null,
  changedPaths: null
}

export type RunBlastRadiusSource = { measure: (runId: string) => Promise<RunBlastRadius> }

/** Null when this host cannot see the worktree — never an empty list, which would read as "clean". */
export type WorktreeChangedFilesReader = (worktreeId: string) => Promise<readonly string[] | null>

/** Null when the backend is unpriced or its usage store cannot answer. Never a guess. */
export type DispatchSpendReader = (dispatch: RunDispatchRow) => Promise<number | null>

export type RunBlastRadiusDeps = {
  getDb: () => OrchestrationDb | null
  readChangedFiles: WorktreeChangedFilesReader
  readDispatchSpendCents: DispatchSpendReader
}

export function createRunBlastRadiusSource(deps: RunBlastRadiusDeps): RunBlastRadiusSource {
  return { measure: (runId) => measureRunBlastRadius(deps, runId) }
}

async function measureRunBlastRadius(
  deps: RunBlastRadiusDeps,
  runId: string
): Promise<RunBlastRadius> {
  const db = deps.getDb()
  if (!db) {
    return UNMEASURED_RUN_BLAST_RADIUS
  }
  let dispatches: RunDispatchRow[]
  try {
    dispatches = db.listRunDispatches(runId)
  } catch (error) {
    console.warn('[alicorn] run dispatches unreadable — blast radius unmeasured', error)
    return UNMEASURED_RUN_BLAST_RADIUS
  }
  // A run that has dispatched nothing has changed nothing and spent nothing. That is a measured
  // zero, not an unknown, and it must not gate.
  if (dispatches.length === 0) {
    return { filesChanged: 0, spendCents: 0, changedPaths: [] }
  }
  const [files, spendCents] = await Promise.all([
    measureFiles(deps, dispatches),
    measureSpend(deps, dispatches)
  ])
  return { ...files, spendCents }
}

async function measureFiles(
  deps: RunBlastRadiusDeps,
  dispatches: readonly RunDispatchRow[]
): Promise<Pick<RunBlastRadius, 'filesChanged' | 'changedPaths'>> {
  const worktreeIds = new Set<string>()
  for (const dispatch of dispatches) {
    if (!dispatch.worktreeId) {
      // A worker dispatch with no worktree ran somewhere we cannot inspect; the run's reach is
      // then partly unknown, and a partly-unknown blast radius is unknown.
      return { filesChanged: null, changedPaths: null }
    }
    worktreeIds.add(dispatch.worktreeId)
  }

  // Keyed by worktree as well as path: `src/a.ts` in two repositories is two files, while two
  // tasks editing it in one worktree is one. Both matter for a file budget.
  const distinct = new Set<string>()
  const changedPaths = new Set<string>()
  for (const worktreeId of worktreeIds) {
    let paths: readonly string[] | null
    try {
      paths = await deps.readChangedFiles(worktreeId)
    } catch (error) {
      console.warn(`[alicorn] changed files unreadable for worktree ${worktreeId}`, error)
      paths = null
    }
    if (paths === null) {
      return { filesChanged: null, changedPaths: null }
    }
    for (const path of paths) {
      distinct.add(`${worktreeId}\u0000${path}`)
      changedPaths.add(path)
    }
  }
  return { filesChanged: distinct.size, changedPaths: [...changedPaths] }
}

async function measureSpend(
  deps: RunBlastRadiusDeps,
  dispatches: readonly RunDispatchRow[]
): Promise<number | null> {
  let total = 0
  for (const dispatch of dispatches) {
    let cents: number | null
    try {
      cents = await deps.readDispatchSpendCents(dispatch)
    } catch (error) {
      console.warn(`[alicorn] spend unreadable for dispatch ${dispatch.dispatchId}`, error)
      cents = null
    }
    // One unpriced dispatch makes the run's total a floor, not a total, and a floor must not be
    // compared against a ceiling. An unpriceable backend cannot buy autonomy.
    if (cents === null) {
      return null
    }
    total += cents
  }
  return total
}
