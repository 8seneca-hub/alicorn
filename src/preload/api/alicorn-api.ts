import type { EscalationOffer } from '../../shared/alicorn/context-ceiling'
import type { ForemanRunViewResult } from '../../shared/alicorn/foreman-run'
import type { Member, MemberInput, OrgPolicy } from '../../shared/alicorn/members'
import type { ProvenanceViewResult } from '../../shared/alicorn/provenance-view'

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
}
