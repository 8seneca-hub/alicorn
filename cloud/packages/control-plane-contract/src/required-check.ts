import { z } from 'zod'
export const DiffCoverageCheckSchema = z.object({
  kind: z.literal('diff_coverage'),
  threshold: z.number().min(0).max(1),
  lcovPath: z.string().min(1).default('coverage/lcov.info'),
  // Why: optional — a project whose test run already writes lcov needs no extra command.
  command: z.string().min(1).max(1000).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).default(600_000)
})
export const RequiredCheckSchema = z.discriminatedUnion('kind', [DiffCoverageCheckSchema])
export const RequiredChecksSchema = z.array(RequiredCheckSchema).max(20)
export type RequiredCheck = z.infer<typeof RequiredCheckSchema>
