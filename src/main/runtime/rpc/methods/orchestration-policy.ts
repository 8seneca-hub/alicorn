import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../schemas'
import { evaluateGateForTask } from '../../../alicorn/gates/gate-evaluation'
import { resolveStageKey } from '../../../../shared/alicorn/stage-keys'
import { resolveGateEvaluationInput } from '../../../alicorn/gates/gate-evaluation-context'
import {
  AUTONOMY_POLICY_MODES,
  defaultAutonomyPolicy,
  hasPolicyExpired
} from '../../../../shared/alicorn/gate-policy'
import type { AutonomyPolicyInput } from '../../../../shared/alicorn/gate-policy'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { OrcaRuntimeService } from '../../orca-runtime'

const PolicyGetParams = z.object({
  project: requiredString('Missing --project'),
  stageKey: OptionalString,
  member: OptionalString
})

const PolicySetParams = z.object({
  project: requiredString('Missing --project'),
  stageKey: OptionalString,
  member: OptionalString,
  // `mode` is the autonomy policy's own mode — one of the two words already spoken for. Nothing
  // else on this wire may reuse it.
  mode: z.enum(AUTONOMY_POLICY_MODES),
  minRuns: OptionalFiniteNumber,
  minAcceptRate: OptionalFiniteNumber,
  maxFiles: OptionalFiniteNumber,
  maxSpendCents: OptionalFiniteNumber,
  expiresAt: OptionalString
})

const PolicyListParams = z.object({ project: requiredString('Missing --project') })

const EvidenceParams = z.object({
  task: requiredString('Missing --task'),
  stageKey: OptionalString
})

/** Bounds mirroring the control plane's zod, so a bad value fails here rather than as a raw 400. */
const PolicyBody = z.object({
  minRuns: z.number().int().nonnegative().max(10_000),
  minAcceptRate: z.number().min(0).max(1),
  maxFiles: z.number().int().positive().max(100_000).nullable(),
  maxSpendCents: z.number().int().nonnegative().max(100_000_000).nullable(),
  expiresAt: z.string().datetime().nullable()
})

export const ORCHESTRATION_POLICY_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.policyGet',
    params: PolicyGetParams,
    handler: async (params, { runtime }) => {
      const directory = requireDirectory(runtime)
      // SK1: canonical, so a policy authored for `Build` is the one a gate on `build` reads.
      const stageKey = resolveStageKey({ reportedPhase: params.stageKey }).stageKey
      const memberId = params.member ?? null
      const [authored, stageConfig] = await Promise.all([
        directory.getAutonomyPolicy({ projectId: params.project, stageKey, memberId }),
        directory.getStageConfig(params.project, stageKey)
      ])
      return {
        projectId: params.project,
        stageKey,
        memberId,
        // The default is returned rather than null so a caller always sees the policy that will be
        // applied; `authored` is how it tells an authored policy from the fallback.
        policy:
          authored ?? defaultAutonomyPolicy({ projectId: params.project, stageKey, memberId }),
        authored: authored !== null,
        // Authored on the stage, never inferred — returned here so a reader can see which hard
        // stop is in force before wondering why a gate never retires.
        stageConfig
      }
    }
  }),

  defineMethod({
    name: 'orchestration.policySet',
    params: PolicySetParams,
    handler: async (params, { runtime }) => {
      const directory = requireDirectory(runtime)
      const body = PolicyBody.safeParse({
        minRuns: params.minRuns ?? 10,
        minAcceptRate: params.minAcceptRate ?? 0.9,
        maxFiles: params.maxFiles ?? null,
        maxSpendCents: params.maxSpendCents ?? null,
        expiresAt: params.expiresAt ?? null
      })
      if (!body.success) {
        throw new Error(`Invalid policy: ${body.error.issues[0]?.message ?? 'bad value'}`)
      }
      // §9: a standing exception expires. Checked here, in zod at the route and as a DB CHECK —
      // the write must not leave this process if it would create an exception that never lapses.
      if (params.mode === 'never_gate' && hasPolicyExpired(body.data.expiresAt, Date.now())) {
        throw new Error(
          'never_gate requires --expires-at in the future: an exception that cannot lapse is not an exception'
        )
      }
      const input: AutonomyPolicyInput = {
        stageKey: resolveStageKey({ reportedPhase: params.stageKey }).stageKey,
        memberId: params.member ?? null,
        mode: params.mode,
        ...body.data
      }
      // A replace, not a patch: an omitted budget clears it, matching the PUT the route performs.
      // `created_by` is the authenticated actor at the control plane and is never sent from here.
      return { policy: await directory.setAutonomyPolicy(params.project, input) }
    }
  }),

  // The audit view for standing exceptions (§9). A read surface only: nothing here revokes a
  // policy, because revoking is `policySet` and should read as the write it is.
  defineMethod({
    name: 'orchestration.policyList',
    params: PolicyListParams,
    handler: async (params, { runtime }) => {
      const directory = requireDirectory(runtime)
      const policies = await directory.listAutonomyPolicies(params.project)
      const now = Date.now()
      const exceptions = policies
        .filter((policy) => policy.mode === 'never_gate')
        .map((policy) => ({
          stageKey: policy.stageKey,
          memberId: policy.memberId,
          createdBy: policy.createdBy,
          createdAt: policy.createdAt,
          expiresAt: policy.expiresAt,
          // Lapsed exceptions are listed, not filtered: "who granted one and when did it end" is
          // exactly what an audit asks. Same lapse test the evaluator uses.
          lapsed: hasPolicyExpired(policy.expiresAt, now)
        }))
      return {
        projectId: params.project,
        policies,
        exceptions,
        standingExceptions: exceptions.filter((exception) => !exception.lapsed).length
      }
    }
  }),

  // Track record for the task's (project, stage, member), plus what the policy would decide now.
  // Keyed on a task rather than on the three ids so it runs the *same* assembly `gateCreate` does;
  // a second path to a gate verdict is the one thing this must not become.
  defineMethod({
    name: 'orchestration.evidence',
    params: EvidenceParams,
    handler: async (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      if (!db.getTask(params.task)) {
        throw new Error(`Task not found: ${params.task}`)
      }
      const directory = requireDirectory(runtime)
      const input = await resolveGateEvaluationInput(db, runtime, {
        taskId: params.task,
        stageKey: params.stageKey
      })
      const evaluation = await evaluateGateForTask(directory, input)
      return {
        taskId: params.task,
        stageKey: input.stageKey,
        projectId: input.projectId,
        memberId: input.memberId,
        trackRecord: evaluation.detail?.trackRecord ?? null,
        policy: evaluation.detail?.policy ?? null,
        policyAuthored: evaluation.detail?.policyAuthored ?? false,
        stageConfig: evaluation.detail
          ? {
              reversibility: evaluation.detail.step.reversibility,
              inheritedCost: evaluation.detail.step.inheritedCost
            }
          : null,
        evidence: evaluation.detail?.evidence ?? null,
        // BR1: which authored rule each reached path matched. `touchedProtectedPath` says whether
        // the run reached the surface; this says where, which is what a human at the gate needs.
        protectedPathMatches: evaluation.detail?.protectedPathMatches ?? [],
        // Advisory. Level 0/1: reading this never resolves a gate, and no caller may treat an
        // `auto` here as permission — `gateCreate` is the only place a decision is acted on.
        wouldDecide: evaluation.decision,
        // SK1: whether the same gate would be retired, and if not, which condition held it. Also
        // advisory — this is the read path, and retiring happens only inside `gateCreate`.
        retirement: evaluation.retirement,
        // False for a free-text key. Nothing is refused for it here; it is why a window may look
        // long and still never retire, and a reader who cannot see it will not work that out.
        stageKeyAuthored: input.stageKeyAuthored
      }
    }
  })
]

function requireDirectory(runtime: OrcaRuntimeService): MemberDirectory {
  const directory = runtime.getAlicornMemberDirectory()
  if (!directory) {
    throw new Error('The Alicorn control plane is not configured; autonomy policy is unavailable')
  }
  return directory
}
