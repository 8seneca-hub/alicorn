/**
 * Writes a workflow's first autonomy policies, one per stage.
 *
 * Sequenced deliberately *after* the evidence read in `gateReasonFor`. Running it before that
 * landed would have opened every non-hard-stop stage from run one with no track record at all,
 * because `evidence` mode returned "no gate" — so authoring the set was the one change that could
 * have turned an unfinished ladder into an unguarded one.
 *
 * Never over an authored stage: someone who has tuned a level is not asking for the starter value
 * back. Failures are reported, never swallowed, but they do not undo what was already written —
 * a partially authored project still gates everywhere it has not been reached, which is the safe
 * direction.
 */
import { autonomyStarterSet } from '../../../../../shared/alicorn/autonomy-starter-set'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import type { AutonomyPolicy } from '../../../../../shared/alicorn/gate-policy'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'

export async function authorAutonomyStarterSet(args: {
  projectId: string
  stages: readonly WorkflowStage[]
  /** Already-authored policies, which are left exactly as they are. */
  existing?: readonly AutonomyPolicy[]
}): Promise<{ ok: true; written: number } | { ok: false; error: string }> {
  const write = window.api?.alicorn?.setAutonomyPolicy
  if (!write) {
    return { ok: false, error: 'no_autonomy_bridge' }
  }
  const authored = new Set((args.existing ?? []).map((policy) => policy.stageKey))
  let written = 0
  for (const { stageName: _stageName, ...policy } of autonomyStarterSet(args.stages)) {
    if (authored.has(policy.stageKey)) {
      continue
    }
    const result = await write(args.projectId, policy)
    if (!result.ok) {
      return { ok: false, error: describeFailure(result) }
    }
    written += 1
  }
  return { ok: true, written }
}
