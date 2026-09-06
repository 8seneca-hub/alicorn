import { z } from 'zod'
import { MemberBackendSchema } from './member.js'

export const EXECUTION_STRATEGIES = ['single', 'orchestrated'] as const
export const ExecutionStrategySchema = z.enum(EXECUTION_STRATEGIES)

export const StepOutcomeInputSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  dispatchId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  worktreeId: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  memberId: z.string().min(1).optional(),
  // Why: `other` covers agents Orca launches but Alicorn does not price or police.
  backend: z.union([MemberBackendSchema, z.literal('other')]).default('other'),
  stageKey: z.string().min(1).max(64).default('build'),
  executionStrategy: ExecutionStrategySchema.default('single'),
  outcome: z.enum(['succeeded', 'failed']),
  filesModified: z.array(z.string()).max(5000).default([]),
  reportSummary: z.string().max(4000).optional(),
  reviewBackendBypass: z.boolean().default(false),
  escalationOffered: z.boolean().default(false),
  escalationAccepted: z.boolean().nullable().default(null),
  clientTs: z.string().datetime().optional()
})

export const SpendPatchSchema = z.object({
  spendCents: z.number().int().nonnegative().nullable(),
  usage: z.record(z.unknown()).nullable().default(null)
})

export const HumanVerdictPatchSchema = z.object({
  humanVerdict: z.enum(['accepted', 'rejected', 'amended']),
  amendedAfterMs: z.number().int().nonnegative().nullable().default(null),
  // Why: what the corrections watcher saw — a follow-up commit, a revert, a reopened task, or a manual call.
  source: z.enum(['follow_up_commit', 'revert', 'reopened_task', 'manual']).default('manual')
})

export const StepVerificationInputSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  dispatchId: z.string().min(1),
  kind: z.enum(['diff_coverage']),
  name: z.string().min(1).max(200),
  required: z.boolean(),
  status: z.enum(['passed', 'failed', 'skipped', 'error']),
  detail: z.record(z.unknown()).default({})
})

export const CONTEXT_CAPTURE_MAX_PROMPT_BYTES = 64 * 1024
export const ContextCaptureInputSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  dispatchId: z.string().min(1),
  // Why: exactly one of prompt / promptPath — overflow is written to a file and the path is recorded.
  prompt: z.string().max(CONTEXT_CAPTURE_MAX_PROMPT_BYTES).optional(),
  promptPath: z.string().min(1).optional(),
  contextSlice: z.record(z.unknown()).default({})
}).refine((v) => (v.prompt === undefined) !== (v.promptPath === undefined), 'exactly one of prompt or promptPath')

export const StepOutcomeRecordSchema = StepOutcomeInputSchema.extend({
  id: z.string(),
  tenantId: z.string(),
  spendCents: z.number().int().nullable(),
  usage: z.record(z.unknown()).nullable(),
  gateDecision: z.string(),
  gateReason: z.string(),
  humanVerdict: z.enum(['accepted', 'rejected', 'amended']).nullable(),
  amendedAfterMs: z.number().int().nullable(),
  createdAt: z.string().datetime()
})
export const StepVerificationRecordSchema = StepVerificationInputSchema.extend({ id: z.string(), createdAt: z.string().datetime() })

export const ProvenanceReportSchema = z.object({
  repoId: z.string(),
  branch: z.string(),
  outcomes: z.array(StepOutcomeRecordSchema),
  verifications: z.array(StepVerificationRecordSchema),
  contextCaptures: z.array(z.object({ dispatchId: z.string(), promptBytes: z.number().int(), createdAt: z.string() })),
  totals: z.object({ spendCents: z.number().int(), tasks: z.number().int(), dispatches: z.number().int() }),
  reviewBackend: z.object({ enforced: z.boolean(), bypassed: z.boolean() })
})

export const RunCostSchema = z.object({
  runId: z.string(),
  totalSpendCents: z.number().int(),
  byDispatch: z.array(z.object({ dispatchId: z.string(), taskId: z.string(), backend: z.string(), spendCents: z.number().int().nullable() }))
})

export type ExecutionStrategy = z.infer<typeof ExecutionStrategySchema>
export type StepOutcomeInput = z.infer<typeof StepOutcomeInputSchema>
export type StepOutcomeRecord = z.infer<typeof StepOutcomeRecordSchema>
export type SpendPatch = z.infer<typeof SpendPatchSchema>
export type HumanVerdictPatch = z.infer<typeof HumanVerdictPatchSchema>
export type StepVerificationInput = z.infer<typeof StepVerificationInputSchema>
export type ContextCaptureInput = z.infer<typeof ContextCaptureInputSchema>
export type ProvenanceReport = z.infer<typeof ProvenanceReportSchema>
export type RunCost = z.infer<typeof RunCostSchema>
