import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { MemberBackend } from '../../shared/alicorn/members'
import type { TuiAgent } from '../../shared/tui-agent'
import { getAuthorBackendsForTask } from './author-backends'
import { evaluateReviewBackend } from './review-backend-policy'
import type { MemberDirectory } from './member-directory'

export type DispatchMemberStamp = {
  memberId: string
  memberRole: string
  backend: MemberBackend
  reviewBackendBypass: boolean
}

export type WorkerMemberLaunch = {
  agent: string | undefined
  dispatchMember: DispatchMemberStamp | null
}

// Every member backend is a TUI agent Orca can launch; the mapping is identity
// today and exists so a rename on either side is caught here rather than at spawn.
export function memberBackendToTuiAgent(backend: MemberBackend): TuiAgent {
  return backend
}

/**
 * Turns `--member <id>` into the agent to launch and the stamp recorded on the
 * dispatch. Runs before any worktree or terminal effect, so a rejected launch
 * leaves nothing behind to clean up.
 */
export async function resolveWorkerMemberLaunch(input: {
  db: OrchestrationDb
  directory: MemberDirectory
  taskId: string
  memberId?: string
  requestedAgent?: string
  allowSameBackendReview?: boolean
}): Promise<WorkerMemberLaunch> {
  if (!input.memberId) {
    return { agent: input.requestedAgent, dispatchMember: null }
  }

  const member = await input.directory.getMember(input.memberId)
  if (!member) {
    throw new OrchestrationError(
      'unknown_member',
      `Member ${input.memberId} not found in this organisation.`
    )
  }

  const agent = memberBackendToTuiAgent(member.backend)
  // Why reject rather than silently prefer one: the caller asked for two
  // different things, and guessing which they meant runs the wrong model.
  if (input.requestedAgent && input.requestedAgent !== agent) {
    throw new OrchestrationError(
      'member_agent_conflict',
      `Member ${member.name} runs on ${member.backend}; --agent ${input.requestedAgent} conflicts. Drop --agent, or pick a member on that backend.`
    )
  }

  let reviewBackendBypass = false
  if (member.role === 'reviewer') {
    const policy = await input.directory.getOrgPolicy()
    const verdict = evaluateReviewBackend({
      reviewerBackend: member.backend,
      authorBackends: getAuthorBackendsForTask(input.db, input.taskId),
      enforce: policy.enforceDistinctReviewerBackend,
      bypassRequested: input.allowSameBackendReview === true
    })
    if (!verdict.allowed) {
      throw new OrchestrationError('reviewer_backend_conflict', verdict.reason)
    }
    reviewBackendBypass = verdict.bypassed
  }

  return {
    agent,
    dispatchMember: {
      memberId: member.id,
      memberRole: member.role,
      backend: member.backend,
      reviewBackendBypass
    }
  }
}
