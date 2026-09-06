import type { EscalationOffer } from '../../shared/alicorn/context-ceiling'
import type { Member, MemberInput, OrgPolicy } from '../../shared/alicorn/members'

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
}
