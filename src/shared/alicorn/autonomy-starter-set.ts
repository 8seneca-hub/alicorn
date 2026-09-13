/**
 * A project's first autonomy policies, one per stage.
 *
 * Derived from the stages themselves rather than a list of names: a workflow that renames `merge`
 * or adds a second irreversible stage must not fall back to gating nothing, and stage metadata is
 * already the authority on what may retire (`reversibility`, `inheritedCost`).
 *
 * Modes follow the prototype's autonomy table, which is the shape this was designed to:
 *
 *  - **irreversible → `always_gate`.** Hard stops never retire whatever the record says, because
 *    guessing wrong once is a production deploy (CLAUDE.md, ARCHITECTURE §7).
 *  - **high inherited cost → `always_gate`.** Architecture is cheap to write and expensive to be
 *    wrong about; every interface built after it inherits the mistake.
 *  - **everything else → `evidence`.** Which still gates — it is the recorded recommendation that
 *    changes, and that is the only way a track record is ever accumulated.
 *
 * `never_gate` is never authored here. It requires an expiry by contract and by CHECK constraint,
 * and a standing exception is a deliberate act, not a starter value.
 */
import type { AutonomyPolicyInput } from './gate-policy'
import { DEFAULT_AUTONOMY_POLICY } from './gate-policy'
import type { WorkflowStage } from './workflows'

/** The prototype's per-run budget: 25 files, $5.00. Applied where a stage may run unattended. */
const BLAST_RADIUS = { maxFiles: 25, maxSpendCents: 500 } as const

export function autonomyStarterSet(
  stages: readonly WorkflowStage[]
): (AutonomyPolicyInput & { stageName: string })[] {
  return stages.map((stage) => {
    const hardStop = stage.reversibility === 'irreversible' || stage.inheritedCost === 'high'
    return {
      stageName: stage.name,
      stageKey: stage.key,
      // Null is the wildcard: it covers every member on the stage, which is what a first policy
      // should do. Narrowing to one member is a later, deliberate act.
      memberId: null,
      ...DEFAULT_AUTONOMY_POLICY,
      mode: hardStop ? ('always_gate' as const) : DEFAULT_AUTONOMY_POLICY.mode,
      // A stage that always gates has a human on it, so a blast-radius budget would be a second
      // answer to a question already asked.
      maxFiles: hardStop ? null : BLAST_RADIUS.maxFiles,
      maxSpendCents: hardStop ? null : BLAST_RADIUS.maxSpendCents
    }
  })
}
