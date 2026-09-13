import { z } from 'zod'

/**
 * What every project starts from.
 *
 * Autonomy is still authored per project *and per stage* — a level here is the value a stage takes
 * when nobody has overridden it, not a switch that reaches into a project. That distinction is what
 * keeps "a member cannot loosen its own criteria" true: an org admin moves the floor, and a project
 * moves its own stages, and neither is the member being judged.
 */
export const AUTONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number]

// Why: decision §11.4 — enforced by default, explicit opt-out, bypass recorded on the run.
export const OrgPolicySchema = z.object({
  enforceDistinctReviewerBackend: z.boolean().default(true),
  /** L2 ships as the floor: runs once the ledger says a stage has earned it. */
  defaultAutonomyLevel: z.enum(AUTONOMY_LEVELS).default('L2')
})
export type OrgPolicy = z.infer<typeof OrgPolicySchema>
