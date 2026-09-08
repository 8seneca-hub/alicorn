import { z } from 'zod'
import { InheritedCostSchema, StageKeySchema, StageReversibilitySchema } from './workflow.js'

/**
 * Autonomy policy, per-project stage attributes and the gate vocabulary (ARCHITECTURE §7).
 *
 * `mode` here is the *autonomy policy* mode — one of the two pre-existing uses of that word
 * (the other is `permission_mode` on a member). Nothing else may reuse it.
 */
export const AUTONOMY_POLICY_MODES = ['always_gate', 'evidence', 'never_gate'] as const
export const AutonomyPolicyModeSchema = z.enum(AUTONOMY_POLICY_MODES)
export type AutonomyPolicyMode = (typeof AUTONOMY_POLICY_MODES)[number]

const AutonomyPolicyShape = {
  stageKey: StageKeySchema.default('build'),
  /** Null means the policy applies to every member on that stage. */
  memberId: z.string().trim().min(1).max(200).nullable().default(null),
  mode: AutonomyPolicyModeSchema,
  minRuns: z.number().int().nonnegative().max(10_000).default(10),
  minAcceptRate: z.number().min(0).max(1).default(0.9),
  maxFiles: z.number().int().positive().max(100_000).nullable().default(null),
  maxSpendCents: z.number().int().nonnegative().max(100_000_000).nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null)
}

// §9: a standing exception expires. The DB carries the same rule as a CHECK, because a policy
// row written by anything other than this route would otherwise never lapse.
function requireExpiryForNeverGate(policy: {
  mode: AutonomyPolicyMode
  expiresAt: string | null
}): boolean {
  return policy.mode !== 'never_gate' || policy.expiresAt !== null
}

const NEVER_GATE_EXPIRY_ISSUE = {
  message: 'never_gate requires an expiry',
  path: ['expiresAt']
}

export const AutonomyPolicyInputSchema = z
  .object(AutonomyPolicyShape)
  .refine(requireExpiryForNeverGate, NEVER_GATE_EXPIRY_ISSUE)

export const AutonomyPolicySchema = z
  .object({
    ...AutonomyPolicyShape,
    projectId: z.string().trim().min(1).max(200),
    createdBy: z.string().min(1),
    createdAt: z.string()
  })
  .refine(requireExpiryForNeverGate, NEVER_GATE_EXPIRY_ISSUE)

export type AutonomyPolicyInput = z.infer<typeof AutonomyPolicyInputSchema>
export type AutonomyPolicy = z.infer<typeof AutonomyPolicySchema>

/**
 * Applied when a project has authored no policy for a stage. `evidence` rather than
 * `always_gate` because level 0 already gates everything — the difference is whether the
 * recorded recommendation says anything useful. An *unreadable* policy is a different case
 * and fails safe at the caller, not here.
 */
export const DEFAULT_AUTONOMY_POLICY_FIELDS = {
  mode: 'evidence',
  minRuns: 10,
  minAcceptRate: 0.9,
  maxFiles: null,
  maxSpendCents: null,
  expiresAt: null
} as const satisfies Pick<
  AutonomyPolicy,
  'mode' | 'minRuns' | 'minAcceptRate' | 'maxFiles' | 'maxSpendCents' | 'expiresAt'
>

export const StageConfigSchema = z.object({
  reversibility: StageReversibilitySchema,
  inheritedCost: InheritedCostSchema
})
export type StageConfig = z.infer<typeof StageConfigSchema>

/** Seeded irreversible because guessing wrong once is a production deploy (ARCHITECTURE §7). */
export const IRREVERSIBLE_STAGE_KEYS = ['merge', 'deploy'] as const

export function defaultStageConfig(stageKey: string): StageConfig {
  return (IRREVERSIBLE_STAGE_KEYS as readonly string[]).includes(stageKey)
    ? { reversibility: 'irreversible', inheritedCost: 'high' }
    : { reversibility: 'contained', inheritedCost: 'low' }
}

/** Ordered exactly as ARCHITECTURE §7 evaluates them; `auto` is the only non-gate outcome. */
export const GATE_DECISION_REASONS = [
  'policy',
  'irreversible',
  'inherited',
  'never_gate',
  'unverified',
  'blast:files',
  'blast:spend',
  'blast:reach',
  'history',
  'accept-rate',
  'regression',
  'auto'
] as const
export const GateDecisionReasonSchema = z.enum(GATE_DECISION_REASONS)
export type GateDecisionReason = (typeof GATE_DECISION_REASONS)[number]

export const GateDecisionSchema = z.object({
  decision: z.enum(['gate', 'auto']),
  reason: GateDecisionReasonSchema
})
export type GateDecision = z.infer<typeof GateDecisionSchema>
