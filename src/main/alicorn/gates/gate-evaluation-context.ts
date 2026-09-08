import { getLatestDispatchForTask } from '../../runtime/orchestration/db/dispatch-context/task-dispatch-reconciliation'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { GateEvaluationInput } from './gate-evaluation'

/** Only the worktree fields a gate needs; keeps this off the full `Worktree` type. */
export type GateWorktreeResolver = {
  showManagedWorktree: (selector: string) => Promise<{ repoId?: string; projectId?: string }>
}

/**
 * Everything the policy reads about *this* task, gathered from the client's own state: which
 * member ran it, which project it belongs to, and what its checks reported. A field that cannot
 * be resolved stays null and the policy gates on it — see `evaluateGateForTask`.
 */
export async function resolveGateEvaluationInput(
  db: OrchestrationDb,
  runtime: GateWorktreeResolver,
  input: { taskId: string; stageKey: string }
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

  return {
    projectId,
    stageKey: input.stageKey,
    memberId,
    verifications: db.listTaskVerifications(input.taskId)
  }
}
