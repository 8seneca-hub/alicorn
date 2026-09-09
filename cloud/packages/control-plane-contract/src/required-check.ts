import { z } from 'zod'
export const DiffCoverageCheckSchema = z.object({
  kind: z.literal('diff_coverage'),
  threshold: z.number().min(0).max(1),
  lcovPath: z.string().min(1).default('coverage/lcov.info'),
  // Why: optional — a project whose test run already writes lcov needs no extra command.
  command: z.string().min(1).max(1000).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).default(600_000)
})
/**
 * CR2: no breaking interface change ships un-acknowledged.
 *
 * No parameters — what counts as breaking is the Contract Registry's answer, and who may
 * acknowledge is the Control API's. A threshold here would be a knob the member being judged could
 * argue with.
 */
export const ContractAcknowledgedCheckSchema = z.object({
  kind: z.literal('contract_acknowledged')
})
export const RequiredCheckSchema = z.discriminatedUnion('kind', [
  DiffCoverageCheckSchema,
  ContractAcknowledgedCheckSchema
])
export const RequiredChecksSchema = z.array(RequiredCheckSchema).max(20)
export type RequiredCheck = z.infer<typeof RequiredCheckSchema>
