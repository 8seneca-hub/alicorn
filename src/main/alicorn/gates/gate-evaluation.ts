import { evaluateGate } from './evaluate-gate'
import { resolveRequiredChecksPassed } from './required-checks-verdict'
import type { RunBlastRadius } from './run-blast-radius'
import { resolveProtectedPathReach } from '../../../shared/alicorn/protected-paths'
import { defaultAutonomyPolicy, type GateDecision } from '../../../shared/alicorn/gate-policy'
import { resolveGateRetirement } from '../../../shared/alicorn/gate-retirement'
import { DEFAULT_STAGE_KEY } from '../../../shared/alicorn/stage-keys'
import type { GateRetirement } from '../../../shared/alicorn/gate-retirement'
import type {
  AutonomyPolicy,
  GateEvidence,
  GateStep,
  StageConfig,
  TrackRecord
} from '../../../shared/alicorn/gate-policy'
import type { ProtectedPath, ProtectedPathMatch } from '../../../shared/alicorn/protected-paths'
import type { RequiredCheck } from '../../../shared/alicorn/members'
import type { DispatchVerificationRow } from '../../runtime/orchestration/db/alicorn/alicorn-rows'

export const DEFAULT_GATE_STAGE_KEY = DEFAULT_STAGE_KEY

/** The admin-authored reads a gate needs, plus GP2's track record. Satisfied by `MemberDirectory`. */
export type GatePolicySource = {
  getAutonomyPolicy: (key: {
    projectId: string
    stageKey: string
    memberId: string | null
  }) => Promise<AutonomyPolicy | null>
  getStageConfig: (projectId: string, stageKey: string) => Promise<StageConfig>
  getRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
  /** BR1's reach surface. Authored by an org admin, never by the member being judged. */
  getProtectedPaths: (projectId: string) => Promise<ProtectedPath[]>
  getTrackRecord: (key: {
    projectId: string
    stageKey: string
    memberId: string
  }) => Promise<TrackRecord>
}

export type GateEvaluationInput = {
  /** Null when the task's worktree could not be resolved to a project. */
  projectId: string | null
  /** Canonical, from `resolveStageKey` — never the caller's raw `--phase`. */
  stageKey: string
  /**
   * SK1: does `stageKey` name an authored stage? Only an authored window may retire a gate. False
   * is the safe answer, so a caller that cannot tell simply keeps gating.
   */
  stageKeyAuthored: boolean
  memberId: string | null
  verifications: DispatchVerificationRow[]
  /** Accumulated over the task's *run*, across every task in it — see `measureBlastRadius`. */
  blastRadius: RunBlastRadius
}

/**
 * The decision, plus everything it was made from. `orchestration.evidence` returns the detail and
 * `gateCreate` uses only the decision, so there is exactly one implementation of a gate verdict —
 * two that could disagree would be worse than none.
 */
export type GateEvaluation = {
  decision: GateDecision
  /**
   * SK1: may this gate stop interrupting? A second, narrower question than `decision` — see
   * `resolveGateRetirement`. Everything that cannot be read gates, so this refuses by default.
   */
  retirement: GateRetirement
  /** Null when the control plane could not be read; the decision is then a fail-safe gate. */
  detail: {
    step: GateStep
    policy: AutonomyPolicy
    /** False when the project authored nothing and the contract default was applied. */
    policyAuthored: boolean
    evidence: GateEvidence
    trackRecord: TrackRecord | null
    /** Which authored rule each reached path matched — what the human at the gate is shown. */
    protectedPathMatches: ProtectedPathMatch[]
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
  let protectedPaths: ProtectedPath[]
  try {
    const [config, policy, checks, paths] = await Promise.all([
      source.getStageConfig(projectId, input.stageKey),
      source.getAutonomyPolicy({
        projectId,
        stageKey: input.stageKey,
        memberId: input.memberId
      }),
      source.getRequiredChecks(projectId),
      source.getProtectedPaths(projectId)
    ])
    stageConfig = config
    authored = policy
    authoredChecks = checks
    protectedPaths = paths
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
  // BR1. Both numbers are the *run's*, summed over its tasks, because a per-task budget is
  // laundered by decomposition. Reach is a match against the authored surface: `false` means we
  // looked and nothing protected was touched, `null` means we could not look, and `evaluateGate`
  // gives those two different reasons.
  const reach = resolveProtectedPathReach(input.blastRadius.changedPaths, protectedPaths)
  const evidence: GateEvidence = {
    allRequiredChecksPassed: resolveRequiredChecksPassed(authoredChecks, input.verifications),
    filesChanged: input.blastRadius.filesChanged,
    spendCents: input.blastRadius.spendCents,
    touchedProtectedPath: reach.touched,
    stats: trackRecord
  }
  const decision = evaluateGate(step, policy, evidence)
  return {
    decision,
    retirement: resolveGateRetirement({
      step,
      policy,
      decision,
      trackRecord,
      stageKeyAuthored: input.stageKeyAuthored
    }),
    detail: {
      step,
      policy,
      policyAuthored: authored !== null,
      evidence,
      trackRecord,
      protectedPathMatches: reach.touched === true ? reach.matches : []
    }
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
  return {
    decision: { decision: 'gate', reason: 'unverified' },
    // Nothing was read, so nothing was earned. `not-earned` is the accurate refusal: the policy
    // did not decide `auto`, because it could not decide at all.
    retirement: { retire: false, refusal: 'not-earned' },
    detail: null
  }
}
