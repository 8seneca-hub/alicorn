import { isLeadLaunchUnsupported, leadLaunchOptions } from './foreman/lead-launch-options'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { isQaLaunchUnsupported, qaLaunchOptions } from './qa-sandbox/qa-launch-options'
import type { RestrictedPaneLaunch } from './agent-pane-role'
import type { MemberBackend, MemberRole } from '../../shared/alicorn/members'
import type { TuiAgent } from '../../shared/tui-agent'
import { getAuthorBackendsForTask } from './author-backends'
import { evaluateReviewBackend } from './review-backend-policy'
import type { MemberDirectory } from './member-directory'

export type DispatchMemberStamp = {
  memberId: string
  memberRole: MemberRole
  backend: MemberBackend
  reviewBackendBypass: boolean
}

export type WorkerMemberLaunch = {
  agent: string | undefined
  dispatchMember: DispatchMemberStamp | null
  /**
   * RB1 Task 4: the member's accepted standing rules, for the dispatch preamble. Read off the
   * Member the launch already resolved, so briefing them costs no second directory call — and an
   * unreachable control plane refuses the named launch long before it could cost a brief its rules.
   */
  memberRules: string
  /**
   * Set for a role the tool boundary restricts — a Foreman lead, or a blindfolded QA member. The
   * launch path applies these to the spawned agent and refuses the dispatch if it cannot.
   */
  restrictedLaunch: RestrictedPaneLaunch | null
}

// Every member backend is a TUI agent Alicorn can launch; the mapping is identity
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
    return {
      agent: input.requestedAgent,
      dispatchMember: null,
      restrictedLaunch: null,
      memberRules: ''
    }
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

  // Why refuse rather than launch anyway: a lead that can quietly write code makes a run look
  // orchestrated while being nothing of the sort, and a QA member that can quietly read the
  // implementation makes a run look blindfolded. Neither would be noticed downstream.
  const restrictedLaunch = resolveRestrictedPaneLaunch({
    backend: member.backend,
    dispatchRole: input.role,
    memberRole: member.role
  })

  return {
    agent,
    dispatchMember: {
      memberId: member.id,
      memberRole: member.role,
      backend: member.backend,
      reviewBackendBypass
    },
    restrictedLaunch,
    memberRules: member.systemRules
  }
}

/**
 * A lead is a lead because the dispatch says so; QA is QA because the Member entity says so. Both
 * resolve here so there is one answer to "does this pane get restricted", rather than a second
 * notion of role growing next to the first.
 *
 * Lead wins when a QA member is dispatched to lead: the lead policy withholds strictly more of the
 * worktree, so the blindfold still holds.
 */
function resolveRestrictedPaneLaunch(input: {
  backend: MemberBackend
  dispatchRole: 'worker' | 'lead' | undefined
  memberRole: MemberRole
}): RestrictedPaneLaunch | null {
  if (input.dispatchRole === 'lead') {
    const options = leadLaunchOptions(input.backend)
    if (isLeadLaunchUnsupported(options)) {
      throw new OrchestrationError('lead_backend_unsupported', options.reason)
    }
    return { role: 'lead', restrictions: options }
  }
  if (input.memberRole !== 'qa') {
    return null
  }
  const options = qaLaunchOptions(input.backend)
  if (isQaLaunchUnsupported(options)) {
    throw new OrchestrationError('qa_backend_unsupported', options.reason)
  }
  return { role: 'qa', restrictions: options }
}
