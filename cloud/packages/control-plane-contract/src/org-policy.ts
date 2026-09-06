import { z } from 'zod'
// Why: decision §11.4 — enforced by default, explicit opt-out, bypass recorded on the run.
export const OrgPolicySchema = z.object({
  enforceDistinctReviewerBackend: z.boolean().default(true)
})
export type OrgPolicy = z.infer<typeof OrgPolicySchema>
