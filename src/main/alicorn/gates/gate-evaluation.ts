import { evaluateGate } from './evaluate-gate'
import { resolveRequiredChecksPassed } from './required-checks-verdict'
import { defaultAutonomyPolicy, type GateDecision } from '../../../shared/alicorn/gate-policy'
import type {
  AutonomyPolicy,
  GateEvidence,
  GateStep,
  StageConfig,
  TrackRecord
} from '../../../shared/alicorn/gate-policy'
import type { RequiredCheck } from '../../../shared/alicorn/members'
import type { DispatchVerificationRow } from '../../runtime/orchestration/db/alicorn/alicorn-rows'

export const DEFAULT_GATE_STAGE_KEY = 'build'

/** The admin-authored reads a gate needs, plus GP2's track record. Satisfied by `MemberDirectory`. */
export type GatePolicySource = {
  getAutonomyPolicy: (key: {
    projectId: string
    stageKey: string
    memberId: string | null
  }) => Promise<AutonomyPolicy | null>
  getStageConfig: (projectId: string, stageKey: string) => Promise<StageConfig>
  getRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
  getTrackRecord: (key: {
    projectId: string
    stageKey: string
    memberId: string
  }) => Promise<TrackRecord>
}

export type GateEvaluationInput = {
  /** Null when the task's worktree could not be resolved to a project. */
  projectId: string | null
  stageKey: string
  memberId: string | null
  verifications: DispatchVerificationRow[]
}

/**
 * The decision, plus everything it was made from. `orchestration.evidence` returns the detail and
 * `gateCreate` uses only the decision, so there is exactly one implementation of a gate verdict —
 * two that could disagree would be worse than none.
 */
export type GateEvaluation = {
  decision: GateDecision
  /** Null when the control plane could not be read; the decision is then a fail-safe gate. */
  detail: {
    step: GateStep
    policy: AutonomyPolicy
    /** False when the project authored nothing and the contract default was applied. */
    policyAuthored: boolean
    evidence: GateEvidence
    trackRecord: TrackRecord | null
  } | null
}

/**
 * Assembles the policy's inputs and evaluates them. Assembly is separate from `evaluateGate` so
 * the order stays a pure, exhaustively tested function and everything that can fail — a missing
 * project, an unreachable control plane — fails in one place, safely.
 */
export async function evaluateGateForTask(
  source: GatePolicySource,
  input: GateEvaluationInput
): Promise<GateEvaluation> {
  if (!input.projectId) {
    return unverified('no project could be resolved for the task')
  }
  const projectId = input.projectId

  let stageConfig: StageConfig
  let authored: AutonomyPolicy | null
  let authoredChecks: RequiredCheck[]
  try {
    const [config, policy, checks] = await Promise.all([
      source.getStageConfig(projectId, input.stageKey),
      source.getAutonomyPolicy({
        projectId,
        stageKey: input.stageKey,
        memberId: input.memberId
      }),
      source.getRequiredChecks(projectId)
    ])
    stageConfig = config
    authored = policy
    authoredChecks = checks
  } catch (error) {
    console.warn('[alicorn] gate policy unreadable — gating', error)
    return unverified('the control plane could not be read')
  }

  // Null means the project authored no policy, which is a real answer with a stated default.
  // A throw means we do not know, and was handled above — the two must not collapse.
  const policy =
    authored ??
    defaultAutonomyPolicy({ projectId, stageKey: input.stageKey, memberId: input.memberId })
  const trackRecord = await readTrackRecord(source, {
    projectId,
    stageKey: input.stageKey,
    memberId: input.memberId
  })

  const step: GateStep = { stageKey: input.stageKey, ...stageConfig }
  const evidence: GateEvidence = {
    allRequiredChecksPassed: resolveRequiredChecksPassed(authoredChecks, input.verifications),
    // Blast radius is BR1's: until it lands nothing computes a file count or a run spend, and
    // both budgets default to null, so the two checks are skipped rather than faked.
    filesChanged: null,
    spendCents: null,
    // False, not null: no project can author a protected path until BR1 adds the surface, so
    // nothing is protected yet. BR1 replaces this with a real match — and a null when the
    // worktree cannot be read.
    touchedProtectedPath: false,
    stats: trackRecord
  }
  return {
    decision: evaluateGate(step, policy, evidence),
    detail: { step, policy, policyAuthored: authored !== null, evidence, trackRecord }
  }
}

/**
 * A separate read from the policy's, and separately tolerant: the track record lives in the Ledger
 * API, so a ledger outage must not read as "the policy is unknown". An absent record gates on
 * `history`, which is the accurate reason and still a gate.
 */
async function readTrackRecord(
  source: GatePolicySource,
  key: { projectId: string; stageKey: string; memberId: string | null }
): Promise<TrackRecord | null> {
  if (!key.memberId) {
    return null
  }
  try {
    return await source.getTrackRecord({ ...key, memberId: key.memberId })
  } catch (error) {
    console.warn('[alicorn] track record unreadable — gating on history', error)
    return null
  }
}

function unverified(why: string): GateEvaluation {
  console.warn(`[alicorn] gate evidence incomplete — ${why}`)
  return { decision: { decision: 'gate', reason: 'unverified' }, detail: null }
}
