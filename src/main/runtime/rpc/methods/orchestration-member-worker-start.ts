import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import { resolveMemberLaunchForRequest } from '../../../alicorn/member-launch-request'
import { prepareLocalWorkerStart } from './orchestration-worker-start-validation'
import type { WorkerStartInput } from './orchestration-worker-start-schema'
import type { LeadLaunchOptions } from '../../../alicorn/foreman/lead-launch-options'

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
    /** Set only for a lead dispatch; the terminal it launches carries these restrictions. */
    leadLaunch: LeadLaunchOptions | null
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
      : {}),
    ...(params.role ? { role: params.role } : {})
  })
  assertLeadLaunchIsApplicable({ leadLaunch: member.leadLaunch, params, createsWorktree })
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
    },
    leadLaunch: member.leadLaunch
  }
}

/**
 * Both refusals exist because a lead whose restrictions were not applied is a lead that can write
 * code, and the run would look orchestrated while being nothing of the sort.
 */
function assertLeadLaunchIsApplicable(args: {
  leadLaunch: LeadLaunchOptions | null
  params: WorkerStartInput
  createsWorktree: boolean
}): void {
  if (!args.leadLaunch) {
    return
  }
  // A lead writes no code, so a worktree of its own would have nothing in it to write to.
  if (args.createsWorktree) {
    throw new OrchestrationError(
      'lead_worktree_unsupported',
      'A lead writes no code and needs no worktree of its own: dispatch it into an existing worktree.'
    )
  }
  // An already-running agent cannot be restricted after the fact.
  if (args.params.terminal) {
    throw new OrchestrationError(
      'lead_terminal_reuse_unsupported',
      'A lead is restricted at launch, so it cannot reuse a running agent terminal: omit --terminal.'
    )
  }
}
