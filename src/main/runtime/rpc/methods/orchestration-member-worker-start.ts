import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import { resolveMemberLaunchForRequest } from '../../../alicorn/member-launch-request'
import { prepareLocalWorkerStart } from './orchestration-worker-start-validation'
import type { WorkerStartInput } from './orchestration-worker-start-schema'
import type { RestrictedPaneLaunch } from '../../../alicorn/agent-pane-role'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { Member } from '../../../../shared/alicorn/members'
import {
  restrictedLaunchTerminalReuseError,
  restrictedLaunchWorktreeError
} from '../../../alicorn/restricted-launch-refusals'

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
    /** Set for a restricted role; the terminal it launches carries these restrictions. */
    restrictedLaunch: RestrictedPaneLaunch | null
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
  assertRestrictedLaunchIsApplicable({
    restrictedLaunch: member.restrictedLaunch,
    params,
    createsWorktree
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
    },
    restrictedLaunch: member.restrictedLaunch
  }
}

/**
 * Both refusals exist because restrictions that were not applied leave a role holding every tool
 * while the run still claims otherwise — a lead that can write code, or a QA member that can read
 * the implementation it is testing. Neither is visible downstream, so the dispatch is refused here.
 *
 * The worktree refusal is a scope limit for QA rather than a principle: `createManagedWorktree`
 * builds its own startup launch and has no seam for launch restrictions, and a QA member started
 * unsandboxed is worse than one that has to be pointed at an existing worktree.
 */
function assertRestrictedLaunchIsApplicable(args: {
  restrictedLaunch: RestrictedPaneLaunch | null
  params: WorkerStartInput
  createsWorktree: boolean
}): void {
  if (!args.restrictedLaunch) {
    return
  }
  if (args.createsWorktree) {
    throw restrictedLaunchWorktreeError(args.restrictedLaunch.role)
  }
  // An already-running agent cannot be restricted after the fact.
  if (args.params.terminal) {
    throw restrictedLaunchTerminalReuseError(args.restrictedLaunch.role)
  }
}

/**
 * RB2 — the learning edge reaching the splitter: the standing rules of every member this lead may
 * dispatch, so a correction a human already paid for shapes the plan and not just the worker.
 *
 * Fail-soft on purpose. The launch has already refused if the lead's own member could not be read;
 * past that point an unreachable control plane must cost the lead its rules, never its dispatch.
 */
export async function readTeamRulesForLead(runtime: {
  getAlicornMemberDirectory: () => MemberDirectory | null
}): Promise<Pick<Member, 'name' | 'systemRules'>[]> {
  try {
    return (await runtime.getAlicornMemberDirectory()?.listMembers()) ?? []
  } catch (error) {
    console.warn('[alicorn] members unreadable — briefing the lead without team rules', error)
    return []
  }
}
