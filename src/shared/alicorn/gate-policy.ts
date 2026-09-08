// Hand-mirrored from cloud/packages/control-plane-contract/src/autonomy-policy.ts.
// Field names must stay identical — the desktop does not import the contract package,
// so a rename there is a silent break here.

/** Slow to earn, immediate to lose — see `resolveGateRetirement`. Never make the two symmetric. */
export const DEMOTION_REASONS = ['rejection', 'amendments'] as const
export type DemotionReason = (typeof DEMOTION_REASONS)[number]

export const AUTONOMY_POLICY_MODES = ['always_gate', 'evidence', 'never_gate'] as const
export const STAGE_REVERSIBILITY = ['free', 'contained', 'irreversible'] as const
export const INHERITED_COSTS = ['low', 'high'] as const

export type AutonomyPolicyMode = (typeof AUTONOMY_POLICY_MODES)[number]
export type StageReversibility = (typeof STAGE_REVERSIBILITY)[number]
export type InheritedCost = (typeof INHERITED_COSTS)[number]

export type AutonomyPolicy = {
  projectId: string
  stageKey: string
  /** Null means the policy applies to every member on that stage. */
  memberId: string | null
  mode: AutonomyPolicyMode
  minRuns: number
  minAcceptRate: number
  maxFiles: number | null
  maxSpendCents: number | null
  createdBy: string
  createdAt: string
  expiresAt: string | null
}

export type StageConfig = {
  reversibility: StageReversibility
  inheritedCost: InheritedCost
}

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

export type GateDecisionReason = (typeof GATE_DECISION_REASONS)[number]
export type GateDecision = { decision: 'gate' | 'auto'; reason: GateDecisionReason }

/** Authored on the stage, never inferred (ARCHITECTURE §7). */
export type GateStep = {
  stageKey: string
  reversibility: StageReversibility
  inheritedCost: InheritedCost
}

export type GateTrackRecord = {
  runs: number
  acceptRate: number
  recentRegression: boolean
}

/**
 * GP2's windowed track record, as the Ledger API serves it. A superset of `GateTrackRecord`, so it
 * drops straight into `GateEvidence.stats`; the extra fields exist for the human reading the
 * recommendation, not for `evaluateGate`, which must never see `level`.
 */
export type TrackRecord = GateTrackRecord & {
  memberId: string
  stageKey: string
  projectId: string
  accepted: number
  rejected: number
  amended: number
  lastAmendedAt: string | null
  /** Derived at read time. SK1's retirement reads it; `evaluateGate` still must not. */
  level: number
  amendmentsObserved: boolean
  /**
   * Which half of the demotion rule fired, or null when neither did. Optional on this side only:
   * a paired host older than SK1 omits it, and a missing reason must read as "not stated" rather
   * than as "not demoted" — `recentRegression` is the field the policy acts on either way.
   */
  demotionReason?: DemotionReason | null
  recentRejected?: number
  recentAmended?: number
}

/** What `policySet` writes. `projectId` is the route, `createdBy` is the authenticated actor. */
export type AutonomyPolicyInput = {
  stageKey: string
  memberId: string | null
  mode: AutonomyPolicyMode
  minRuns: number
  minAcceptRate: number
  maxFiles: number | null
  maxSpendCents: number | null
  expiresAt: string | null
}

/**
 * Has a standing exception lapsed? Shared by the policy evaluator and the audit view so the two
 * can never disagree about which exceptions are still live.
 *
 * A missing expiry counts as lapsed, and so does an unparseable one: the schema and the DB CHECK
 * both require a real date, so a value that got here malformed is corruption, and corruption must
 * not grant autonomy.
 */
export function hasPolicyExpired(expiresAt: string | null, nowMs: number): boolean {
  if (expiresAt === null) {
    return true
  }
  const at = Date.parse(expiresAt)
  return Number.isNaN(at) || at <= nowMs
}

/**
 * Everything the policy is allowed to look at. Every field is nullable because "we could not
 * find out" is a real answer — an SSH host out of contact, a folder workspace with no diff, a
 * control plane that is down — and it must never read as "fine".
 */
export type GateEvidence = {
  allRequiredChecksPassed: boolean | null
  filesChanged: number | null
  spendCents: number | null
  touchedProtectedPath: boolean | null
  stats: GateTrackRecord | null
}

/** Applied when a project has authored no policy — see the contract for why it is not always_gate. */
export function defaultAutonomyPolicy(input: {
  projectId: string
  stageKey: string
  memberId: string | null
}): AutonomyPolicy {
  return {
    ...input,
    mode: 'evidence',
    minRuns: 10,
    minAcceptRate: 0.9,
    maxFiles: null,
    maxSpendCents: null,
    createdBy: 'default',
    createdAt: '',
    expiresAt: null
  }
}

export const IRREVERSIBLE_STAGE_KEYS = ['merge', 'deploy'] as const

export function defaultStageConfig(stageKey: string): StageConfig {
  return (IRREVERSIBLE_STAGE_KEYS as readonly string[]).includes(stageKey)
    ? { reversibility: 'irreversible', inheritedCost: 'high' }
    : { reversibility: 'contained', inheritedCost: 'low' }
}
