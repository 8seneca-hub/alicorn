import { getLatestDispatchForTask } from '../../runtime/orchestration/db/dispatch-context/task-dispatch-reconciliation'
import { UNMEASURED_RUN_BLAST_RADIUS, type RunBlastRadiusSource } from './run-blast-radius'
import { resolveStageKey } from '../../../shared/alicorn/stage-keys'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { GateEvaluationInput } from './gate-evaluation'

/** Only the runtime surface a gate needs; keeps this off the full `OrcaRuntimeService` type. */
export type GateWorktreeResolver = {
  showManagedWorktree: (selector: string) => Promise<{ repoId?: string; projectId?: string }>
  /** Null when the desktop has not installed one — the blast radius is then unmeasured, so gated. */
  getAlicornBlastRadiusSource: () => RunBlastRadiusSource | null
}

/**
 * Everything the policy reads about *this* task, gathered from the client's own state: which
 * member ran it, which project it belongs to, and what its checks reported. A field that cannot
 * be resolved stays null and the policy gates on it — see `evaluateGateForTask`.
 */
export async function resolveGateEvaluationInput(
  db: OrchestrationDb,
  runtime: GateWorktreeResolver,
  input: { taskId: string; stageKey?: string | null }
): Promise<GateEvaluationInput> {
  const dispatch = getLatestDispatchForTask(db, input.taskId)
  const memberId = dispatch ? (db.getDispatchMember(dispatch.id)?.memberId ?? null) : null
  const worktreeId = dispatch ? (db.getWorkerDispatch(dispatch.id)?.worktree_id ?? null) : null

  let projectId: string | null = null
  if (worktreeId) {
    try {
      const worktree = await runtime.showManagedWorktree(`id:${worktreeId}`)
      projectId = worktree.projectId ?? worktree.repoId ?? null
    } catch {
      projectId = null
    }
  }

  // SK1: the board column that dispatched the task wins over anything the caller named, and both
  // are folded onto a template key. The gate is then evaluated under the same key the ledger
  // measures the window under — a gate judged on `Build` against a window keyed `build` compares
  // a stage to nothing.
  const stage = resolveStageKey({
    boardColumnId: dispatch
      ? (db.getBoardTransitionByDispatch(dispatch.id)?.toStatusId ?? null)
      : null,
    reportedPhase: input.stageKey
  })

  return {
    projectId,
    stageKey: stage.stageKey,
    stageKeyAuthored: stage.authored,
    memberId,
    verifications: db.listTaskVerifications(input.taskId),
    blastRadius: await measureBlastRadius(db, runtime, input.taskId)
  }
}

/**
 * BR1's budget accumulates over the task's **run**, not the task: five small tasks in one run sum
 * past a ceiling no single one of them would breach, which is exactly how a budget counted per
 * task is laundered.
 */
async function measureBlastRadius(
  db: OrchestrationDb,
  runtime: GateWorktreeResolver,
  taskId: string
): Promise<GateEvaluationInput['blastRadius']> {
  const source = runtime.getAlicornBlastRadiusSource()
  const runId = db.getTask(taskId)?.run_id
  if (!source || !runId) {
    return UNMEASURED_RUN_BLAST_RADIUS
  }
  try {
    return await source.measure(runId)
  } catch (error) {
    console.warn('[alicorn] blast radius unmeasured — gating', error)
    return UNMEASURED_RUN_BLAST_RADIUS
  }
}
