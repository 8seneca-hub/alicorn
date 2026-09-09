import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { MemberDirectory } from './member-directory'
import {
  assertLeadDispatchNamesMember,
  resolveWorkerMemberLaunch,
  type WorkerMemberLaunch
} from './worker-member-launch'

type DirectoryHost = { getAlicornMemberDirectory: () => MemberDirectory | null }

/**
 * The `--member` entry point for worker-start and dispatch. Separate from
 * `resolveWorkerMemberLaunch` so the RPC handlers gain a few lines rather than
 * the directory lookup and its unconfigured case.
 */
export async function resolveMemberLaunchForRequest(input: {
  runtime: DirectoryHost
  db: OrchestrationDb
  taskId: string
  memberId?: string
  requestedAgent?: string
  allowSameBackendReview?: boolean
  role?: 'worker' | 'lead'
}): Promise<WorkerMemberLaunch> {
  assertLeadDispatchNamesMember(input)
  if (!input.memberId) {
    return {
      agent: input.requestedAgent,
      dispatchMember: null,
      restrictedLaunch: null,
      memberRules: ''
    }
  }
  const directory = input.runtime.getAlicornMemberDirectory()
  // Why reject rather than launch anyway: a member launch that records no
  // member is indistinguishable from a direct launch in the ledger.
  if (!directory) {
    throw new OrchestrationError(
      'control_plane_unconfigured',
      'Members require the Alicorn control plane; set ALICORN_CONTROL_API_URL and ALICORN_LOCAL_API_TOKEN.'
    )
  }
  return resolveWorkerMemberLaunch({
    db: input.db,
    directory,
    taskId: input.taskId,
    ...(input.memberId ? { memberId: input.memberId } : {}),
    ...(input.requestedAgent ? { requestedAgent: input.requestedAgent } : {}),
    ...(input.allowSameBackendReview !== undefined
      ? { allowSameBackendReview: input.allowSameBackendReview }
      : {}),
    ...(input.role ? { role: input.role } : {})
  })
}
