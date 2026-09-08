import { evaluateGate } from './evaluate-gate'
import { resolveRequiredChecksPassed } from './required-checks-verdict'
import { defaultAutonomyPolicy, type GateDecision } from '../../../shared/alicorn/gate-policy'
import type { AutonomyPolicy, StageConfig } from '../../../shared/alicorn/gate-policy'
import type { RequiredCheck } from '../../../shared/alicorn/members'
import type { DispatchVerificationRow } from '../../runtime/orchestration/db/alicorn/alicorn-rows'

export const DEFAULT_GATE_STAGE_KEY = 'build'

/** The three admin-authored reads a gate needs. Satisfied by `MemberDirectory` in production. */
export type GatePolicySource = {
  getAutonomyPolicy: (key: {
    projectId: string
    stageKey: string
    memberId: string | null
  }) => Promise<AutonomyPolicy | null>
  getStageConfig: (projectId: string, stageKey: string) => Promise<StageConfig>
  getRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
}

export type GateEvaluationInput = {
  /** Null when the task's worktree could not be resolved to a project. */
  projectId: string | null
  stageKey: string
  memberId: string | null
  verifications: DispatchVerificationRow[]
}

/**
 * Assembles the policy's three inputs and evaluates them. Assembly is separate from
 * `evaluateGate` so the order stays a pure, exhaustively tested function and everything that can
 * fail — a missing project, an unreachable control plane — fails in one place, safely.
 */
export async function evaluateGateForTask(
  source: GatePolicySource,
  input: GateEvaluationInput
): Promise<GateDecision> {
  if (!input.projectId) {
    return unverified('no project could be resolved for the task')
  }
  const projectId = input.projectId

  let stageConfig: StageConfig
  let policy: AutonomyPolicy
  let authoredChecks: RequiredCheck[]
  try {
    const [config, authored, checks] = await Promise.all([
      source.getStageConfig(projectId, input.stageKey),
      source.getAutonomyPolicy({
        projectId,
        stageKey: input.stageKey,
        memberId: input.memberId
      }),
      source.getRequiredChecks(projectId)
    ])
    stageConfig = config
    // Null means the project authored no policy, which is a real answer with a stated default.
    // A throw means we do not know, and is handled below — the two must not collapse.
    policy =
      authored ??
      defaultAutonomyPolicy({ projectId, stageKey: input.stageKey, memberId: input.memberId })
    authoredChecks = checks
  } catch (error) {
    console.warn('[alicorn] gate policy unreadable — gating', error)
    return unverified('the control plane could not be read')
  }

  return evaluateGate({ stageKey: input.stageKey, ...stageConfig }, policy, {
    allRequiredChecksPassed: resolveRequiredChecksPassed(authoredChecks, input.verifications),
    // Blast radius is BR1's: until it lands nothing computes a file count or a run spend, and
    // both budgets default to null, so the two checks are skipped rather than faked.
    filesChanged: null,
    spendCents: null,
    // False, not null: no project can author a protected path until BR1 adds the surface, so
    // nothing is protected yet. BR1 replaces this with a real match — and a null when the
    // worktree cannot be read.
    touchedProtectedPath: false,
    // Track record is GP2's windowed evidence read. Absent, every stage gates on 'history',
    // which is exactly right: evidence only accumulates by running gated.
    stats: null
  })
}

function unverified(why: string): GateDecision {
  console.warn(`[alicorn] gate evidence incomplete — ${why}`)
  return { decision: 'gate', reason: 'unverified' }
}
