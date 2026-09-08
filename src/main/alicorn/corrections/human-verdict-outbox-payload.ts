import type { HumanVerdictPatch } from '../../../shared/alicorn/ledger-inputs'
import type { RuleProposalContext } from '../../../shared/alicorn/rule-proposals'

/**
 * What the corrections sweep enqueues and the drainer reads back for one `human_verdict_patch`
 * row. The rule-proposal half is optional on purpose: rows written before RB1, and corrections on
 * a dispatch that named no member, carry the verdict alone and propose nothing.
 */
export type HumanVerdictOutboxPayload = HumanVerdictPatch & {
  outcomeId: string
  memberId?: string
  ruleContext?: RuleProposalContext
}
