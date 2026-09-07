import {
  isLeadLaunchUnsupported,
  leadLaunchOptions,
  type LeadLaunchOptions
} from './foreman/lead-launch-options'
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
  /** Set only for a lead dispatch; the launch path applies these to the spawned agent. */
  leadLaunch: LeadLaunchOptions | null
}

// Every member backend is a TUI agent Orca can launch; the mapping is identity
// today and exists so a rename on either side is caught here rather than at spawn.
export function memberBackendToTuiAgent(backend: MemberBackend): TuiAgent {
  return backend
}

/**
 * A lead is a member, always: an anonymous lead has no backend whose tools can be restricted.
 * Shared with the request entry point so the refusal cannot depend on whether the control plane
 * happens to be configured.
 */
export function assertLeadDispatchNamesMember(input: {
  memberId?: string
  role?: 'worker' | 'lead'
}): void {
  if (input.role === 'lead' && !input.memberId) {
    throw new OrchestrationError(
      'lead_member_required',
      'A lead dispatch names the member that leads it: pass --member.'
    )
  }
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
  role?: 'worker' | 'lead'
}): Promise<WorkerMemberLaunch> {
  assertLeadDispatchNamesMember(input)
  if (!input.memberId) {
    return { agent: input.requestedAgent, dispatchMember: null, leadLaunch: null }
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

  // Why refuse rather than launch a lead anyway: a lead that can quietly write code makes a run
  // look orchestrated while being nothing of the sort, and nothing downstream would notice.
  let leadLaunch: LeadLaunchOptions | null = null
  if (input.role === 'lead') {
    const options = leadLaunchOptions(member.backend)
    if (isLeadLaunchUnsupported(options)) {
      throw new OrchestrationError('lead_backend_unsupported', options.reason)
    }
    leadLaunch = options
  }

  return {
    agent,
    dispatchMember: {
      memberId: member.id,
      memberRole: member.role,
      backend: member.backend,
      reviewBackendBypass
    },
    leadLaunch
  }
}
