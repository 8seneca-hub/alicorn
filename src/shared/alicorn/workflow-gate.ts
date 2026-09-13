/**
 * Whether a task may move to the next stage on its own, or has to ask.
 *
 * **This is the rule the agent cannot route around.** A workflow drawn on a screen is decoration;
 * what makes it binding is that the only way an agent can move a task is through the `alicorn_*`
 * tools, and those call this. The same function answers for the UI, so a human and an agent are
 * judged by one rule — the human is simply allowed to overrule the answer, and an agent is not.
 *
 * Three reasons a stage gates, and the order matters only for the message:
 *
 *  - **irreversible** — a merge or a deploy. Hard stops never retire whatever the track record
 *    says, because guessing wrong once is a production deploy (ARCHITECTURE §7).
 *  - **inherited cost** — architecture. Cheap to write, expensive to be wrong about, and every
 *    interface built afterwards inherits the mistake.
 *  - **policy** — the project authored `always_gate` for that stage, or authored nothing at all.
 *
 * A stage with no policy gates. That is deliberate: the absence of a decision is not permission,
 * and `evidence` is something a project opts into.
 */
import type { AutonomyPolicy } from './gate-policy'
import type { WorkflowStage } from './workflows'

export type StageAdvance =
  | { kind: 'advance'; to: WorkflowStage }
  | { kind: 'gated'; to: WorkflowStage; reason: GateReason }
  | { kind: 'finished' }
  | { kind: 'unknown-stage' }

export const GATE_REASONS = ['irreversible', 'inherited_cost', 'policy', 'no_policy'] as const
export type GateReason = (typeof GATE_REASONS)[number]

export function describeGateReason(reason: GateReason, stageName: string): string {
  if (reason === 'irreversible') {
    return `${stageName} is irreversible, so it always gates — hard stops never retire.`
  }
  if (reason === 'inherited_cost') {
    return `${stageName} carries inherited cost: everything built after it inherits the mistake, so it always gates.`
  }
  if (reason === 'policy') {
    return `${stageName} is authored always_gate for this project.`
  }
  return `${stageName} has no autonomy policy, and no policy means a human decides.`
}

/** Null when nothing gates it. Order is message quality only — any one of them is enough. */
export function gateReasonFor(
  stage: WorkflowStage,
  policies: readonly AutonomyPolicy[]
): GateReason | null {
  if (stage.reversibility === 'irreversible') {
    return 'irreversible'
  }
  if (stage.inheritedCost === 'high') {
    return 'inherited_cost'
  }
  // The wildcard row (`memberId: null`) is the project's answer for every member on the stage; a
  // member-specific row is narrower and wins where it exists.
  const forStage = policies.filter((policy) => policy.stageKey === stage.key)
  const policy = forStage.find((candidate) => candidate.memberId !== null) ?? forStage[0]
  if (!policy) {
    return 'no_policy'
  }
  return policy.mode === 'always_gate' ? 'policy' : null
}

/** Stages in the order they run. Authored ordinals win over array order, which is presentational. */
function ordered(stages: readonly WorkflowStage[]): WorkflowStage[] {
  return [...stages].sort((left, right) => left.ordinal - right.ordinal)
}

export function planStageAdvance(args: {
  stages: readonly WorkflowStage[]
  policies: readonly AutonomyPolicy[]
  /** Null means the task has not started; the first stage is next. */
  from: string | null
  /** Stages this task does not need — stepped over, never entered. */
  skipped?: readonly string[]
}): StageAdvance {
  const skipped = new Set(args.skipped ?? [])
  const stages = ordered(args.stages).filter(
    // A skipped stage is not in the pipeline for this task, so it is neither advanced into nor
    // counted when deciding what "one stage forward" means.
    (stage) => !skipped.has(stage.key) || stage.key === args.from
  )
  if (stages.length === 0) {
    return { kind: 'finished' }
  }
  if (args.from === null) {
    const first = stages[0]!
    const reason = gateReasonFor(first, args.policies)
    return reason ? { kind: 'gated', to: first, reason } : { kind: 'advance', to: first }
  }
  const index = stages.findIndex((stage) => stage.key === args.from)
  if (index === -1) {
    return { kind: 'unknown-stage' }
  }
  const next = stages[index + 1]
  if (!next) {
    return { kind: 'finished' }
  }
  const reason = gateReasonFor(next, args.policies)
  return reason ? { kind: 'gated', to: next, reason } : { kind: 'advance', to: next }
}

/**
 * May an agent mark this stage as not needed?
 *
 * Only where the stage does not gate. "Not needed" is a scope judgement, and an agent that could
 * make it about a merge would have walked around the gate by relabelling it — the refusal would be
 * intact and useless. A human may skip anything, because a human is who the gate escalates to.
 */
export function agentMaySkip(stage: WorkflowStage, policies: readonly AutonomyPolicy[]): boolean {
  return gateReasonFor(stage, policies) === null
}

/**
 * Is this column change a legal one for an agent to make?
 *
 * The board is the other way to move a task, and an agent that cannot skip a stage through
 * `advance_stage` must not be able to skip one by dragging. A column belonging to a stage more than
 * one step ahead is a skip; the stage rules then decide whether even that one step is allowed.
 */
export function columnAdvanceIsLegal(args: {
  stages: readonly WorkflowStage[]
  from: string | null
  toColumn: string
}): boolean {
  const stages = ordered(args.stages)
  const target = stages.findIndex((stage) => stage.columnId === args.toColumn)
  if (target === -1) {
    // A column no stage dispatches is not part of the pipeline — moving there skips nothing.
    return true
  }
  const current = args.from === null ? -1 : stages.findIndex((stage) => stage.key === args.from)
  return target <= current + 1
}
