import { z } from 'zod'

export const RULE_PROPOSAL_VERDICTS = ['amended', 'rejected'] as const
export const RULE_PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected'] as const

export const RuleProposalVerdictSchema = z.enum(RULE_PROPOSAL_VERDICTS)
export const RuleProposalStatusSchema = z.enum(RULE_PROPOSAL_STATUSES)

// Why: assembled upstream by the corrections watcher (sha, files, an excerpt bounded to 4 KB —
// docs/alicorn/plans/2026-09-06-rulebook.md RB-R3).
// Why unknown keys are stripped rather than passed through: every known field here is bounded,
// but passthrough would let any authenticated caller store an arbitrarily large blob in a jsonb
// column the Members pane reads back. A producer that grows a field adds it here first, which is
// the same additive discipline every other wire change on this project follows.
export const RuleProposalContextSchema = z.object({
  sha: z.string().optional(),
  files: z.array(z.string()).max(200).optional(),
  excerpt: z.string().max(4096).optional()
})

export const RuleProposalInputSchema = z.object({
  memberId: z.string().min(1),
  outcomeId: z.string().min(1),
  verdict: RuleProposalVerdictSchema,
  context: RuleProposalContextSchema
})

export const RuleProposalSchema = RuleProposalInputSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  proposedRule: z.string().nullable(),
  status: RuleProposalStatusSchema,
  decidedBy: z.string().nullable(),
  decidedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
})

export type RuleProposalVerdict = z.infer<typeof RuleProposalVerdictSchema>
export type RuleProposalStatus = z.infer<typeof RuleProposalStatusSchema>
export type RuleProposalContext = z.infer<typeof RuleProposalContextSchema>
export type RuleProposalInput = z.infer<typeof RuleProposalInputSchema>
export type RuleProposal = z.infer<typeof RuleProposalSchema>
