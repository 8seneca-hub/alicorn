import type { EscalationOffer } from '../../shared/alicorn/escalation-offer'
import type { ForemanRunViewResult } from '../../shared/alicorn/foreman-run'
import type { Member, MemberInput, OrgPolicy } from '../../shared/alicorn/members'
import type { ProvenanceViewResult } from '../../shared/alicorn/provenance-view'
import type {
  ContextCaptureDetailResult,
  RunInspectorViewResult
} from '../../shared/alicorn/run-inspector-view'
import type { GateResolveResult, PendingGatesResult } from '../../shared/alicorn/gate-review'
import type {
  RuleProposalDecisionResult,
  RuleProposalsListResult,
  RuleProposalStatus
} from '../../shared/alicorn/rule-proposals'

export type AlicornFailure = { ok: false; error: string }

export type AlicornApi = {
  listMembers: () => Promise<{ ok: true; members: Member[] } | AlicornFailure>
  createMember: (input: MemberInput) => Promise<{ ok: true; member: Member } | AlicornFailure>
  updateMember: (
    id: string,
    input: MemberInput
  ) => Promise<{ ok: true; member: Member } | AlicornFailure>
  deleteMember: (id: string) => Promise<{ ok: true } | AlicornFailure>
  getOrgPolicy: () => Promise<{ ok: true; policy: OrgPolicy } | AlicornFailure>
  setTaskExecutionStrategy: (args: {
    taskId: string
    strategy: 'single' | 'orchestrated'
    source: 'user' | 'escalation'
  }) => Promise<{ ok: boolean }>
  onEscalationOffer: (callback: (payload: EscalationOffer) => void) => () => void
  /** The journal the given workspace's run is keeping, read from disk on every call. */
  getForemanRun: (worktreeId: string) => Promise<ForemanRunViewResult>
  /** Everything the ledger recorded for a branch, already projected for display. */
  getProvenance: (args: { repoId: string; branch: string }) => Promise<ProvenanceViewResult>
  /** One run of a branch: its dispatches, where each prompt lives, and what the run cost.
   *  Carries no prompt text — `getContextCapture` fetches a body for one dispatch. */
  getRunInspector: (args: {
    repoId: string
    branch: string
    runId?: string | null
  }) => Promise<RunInspectorViewResult>
  /** The exact prompt and context slice one dispatch was given. */
  getContextCapture: (args: {
    runId: string
    dispatchId: string
  }) => Promise<ContextCaptureDetailResult>
  /** Gates still waiting on a human, with the policy's recommendation where level 1 allows it. */
  listPendingGates: () => Promise<PendingGatesResult>
  /** Resolves a gate and records whether the human's call matched the policy's (GP3). */
  resolveGate: (args: {
    gateId: string
    resolution: string
    humanGateDecision: 'gate' | 'auto'
  }) => Promise<GateResolveResult>
  /** Standing rules a correction proposed for this member, newest first (RB1). */
  listRuleProposals: (args: {
    memberId: string
    status?: RuleProposalStatus
  }) => Promise<RuleProposalsListResult>
  /**
   * Accepts a proposal with the rule a human wrote, appending it to the member's system rules and
   * — unless `commitToRepo` is false — committing it into `worktreeId`'s repository.
   */
  acceptRuleProposal: (args: {
    id: string
    rule: string
    memberName: string
    worktreeId: string | null
    commitToRepo: boolean
  }) => Promise<RuleProposalDecisionResult>
  rejectRuleProposal: (args: { id: string }) => Promise<RuleProposalDecisionResult>
}
