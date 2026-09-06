import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import { resolveMemberLaunchForRequest } from '../../../alicorn/member-launch-request'
import { prepareLocalWorkerStart } from './orchestration-worker-start-validation'
import type { WorkerStartInput } from './orchestration-worker-start-schema'

/**
 * Member resolution and local worker-start validation as one step, so the
 * worker-start handler gains a call rather than the whole member branch.
 *
 * Runs before any worktree or terminal effect: a rejected member launch must
 * leave nothing behind to clean up.
 */
export async function prepareMemberAwareWorkerStart(args: {
  params: WorkerStartInput
  createsWorktree: boolean
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  taskId: string
}): Promise<
  ReturnType<typeof prepareLocalWorkerStart> & {
    /** No-ops for a direct launch, so the caller needs no null check. */
    stampMember: (dispatchId: string) => void
  }
> {
  const { params, createsWorktree, runtime, db, taskId } = args
  const member = await resolveMemberLaunchForRequest({
    runtime,
    db,
    taskId,
    ...(params.member ? { memberId: params.member } : {}),
    ...(params.agent ? { requestedAgent: params.agent } : {}),
    ...(params.allowSameBackendReview !== undefined
      ? { allowSameBackendReview: params.allowSameBackendReview }
      : {})
  })
  // The member's backend wins over --agent; a conflict already threw above.
  const prepared = prepareLocalWorkerStart({
    params: member.dispatchMember ? { ...params, agent: member.agent } : params,
    createsWorktree,
    runtime
  })
  const stamp = member.dispatchMember
  return {
    ...prepared,
    stampMember: (dispatchId) => {
      if (stamp) {
        db.setDispatchMember({ dispatchId, ...stamp })
      }
    }
  }
}
