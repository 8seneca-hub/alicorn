/**
 * Whether a task may move to the next stage on its own, or has to ask.
 *
 * **This is the rule the agent cannot route around.** A workflow drawn on a screen is decoration;
 * what makes it binding is that the only way an agent can move a task is through the `alicorn_*`
 * tools, and those call this. The same function answers for the UI, so a human and an agent are
 * judged by one rule — the human is simply allowed to overrule the answer, and an agent is not.
 *
 * Four reasons a stage gates, and the order matters only for the message:
 *
 *  - **irreversible** — a merge or a deploy. Hard stops never retire whatever the track record
 *    says, because guessing wrong once is a production deploy (ARCHITECTURE §7).
 *  - **inherited cost** — architecture. Cheap to write, expensive to be wrong about, and every
 *    interface built afterwards inherits the mistake.
 *  - **policy** — the project authored `always_gate` for that stage, or authored nothing at all.
 *  - **the bar is not cleared yet** — the stage runs on `evidence`, and the member's windowed track
 *    record is short of the `minRuns`/`minAcceptRate` the project authored, or has regressed. This
 *    is what makes an autonomy level mean something: without it L1 and L2 behave like L3 and the
 *    first run goes through unasked.
 *
 * A stage with no policy gates. That is deliberate: the absence of a decision is not permission,
 * and `evidence` is something a project opts into. So does a stage whose track record could not be
 * read — unknown evidence is not permission either.
 */
import { evidenceShortfall } from './evidence-bar'
import { hasPolicyExpired } from './gate-policy'
import type { AutonomyPolicy, GateTrackRecord } from './gate-policy'
import type { WorkflowStage } from './workflows'

export type StageAdvance =
  | { kind: 'advance'; to: WorkflowStage }
  | { kind: 'gated'; to: WorkflowStage; reason: GateReason }
  | { kind: 'finished' }
  | { kind: 'unknown-stage' }

// The last three are spelled as `GateDecisionReason` spells them, not in this file's snake_case:
// one vocabulary across both gate paths is worth more than one file's consistency.
export const GATE_REASONS = [
  'irreversible',
  'inherited_cost',
  'policy',
  'no_policy',
  'history',
  'accept-rate',
  'regression'
] as const
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
  if (reason === 'history') {
    return `${stageName} has not run enough times for its autonomy bar, so it still asks.`
  }
  if (reason === 'accept-rate') {
    return `${stageName} is below the accept rate this project requires before it runs unasked.`
  }
  if (reason === 'regression') {
    return `${stageName} was recently rejected or amended, which takes its autonomy back until the bar is met again.`
  }
  return `${stageName} has no autonomy policy, and no policy means a human decides.`
}

/**
 * Null when nothing gates it. Order is message quality only — any one of them is enough.
 *
 * `stats` is the member's windowed track record for this stage, and omitting it gates every
 * `evidence` stage on `history`: a caller that did not look has not established that anything was
 * earned. That is the fail-closed direction, which is the one a gate must fail in.
 */
export function gateReasonFor(
  stage: WorkflowStage,
  policies: readonly AutonomyPolicy[],
  stats: GateTrackRecord | null = null,
  options?: { now?: () => number }
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
  if (policy.mode === 'always_gate') {
    return 'policy'
  }
  // A standing exception that has lapsed is not an exception; the policy falls back to `evidence`.
  if (
    policy.mode === 'never_gate' &&
    !hasPolicyExpired(policy.expiresAt, options?.now?.() ?? Date.now())
  ) {
    return null
  }
  return evidenceShortfall(policy, stats)
}

/** Stages in the order they run. Authored ordinals win over array order, which is presentational. */
function ordered(stages: readonly WorkflowStage[]): WorkflowStage[] {
  return [...stages].sort((left, right) => left.ordinal - right.ordinal)
}

/**
 * Which stage is one step forward, before anything asks whether it may be entered.
 *
 * Split out because the track record a gate reads is keyed by stage, so the caller has to know
 * which stage it is asking about before it can read the evidence for it.
 */
export type NextStage =
  | { kind: 'stage'; stage: WorkflowStage }
  | { kind: 'finished' }
  | { kind: 'unknown-stage' }

export function nextStageAfter(args: {
  stages: readonly WorkflowStage[]
  from: string | null
  skipped?: readonly string[]
}): NextStage {
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
    return { kind: 'stage', stage: stages[0]! }
  }
  const index = stages.findIndex((stage) => stage.key === args.from)
  if (index === -1) {
    return { kind: 'unknown-stage' }
  }
  const next = stages[index + 1]
  return next ? { kind: 'stage', stage: next } : { kind: 'finished' }
}

export function planStageAdvance(args: {
  stages: readonly WorkflowStage[]
  policies: readonly AutonomyPolicy[]
  /** Null means the task has not started; the first stage is next. */
  from: string | null
  /** Stages this task does not need — stepped over, never entered. */
  skipped?: readonly string[]
  /** The target stage's track record. Absent gates it — see `gateReasonFor`. */
  stats?: GateTrackRecord | null
}): StageAdvance {
  const next = nextStageAfter(args)
  if (next.kind !== 'stage') {
    return next
  }
  const reason = gateReasonFor(next.stage, args.policies, args.stats ?? null)
  return reason ? { kind: 'gated', to: next.stage, reason } : { kind: 'advance', to: next.stage }
}

/**
 * May an agent mark this stage as not needed?
 *
 * Only where the stage does not gate. "Not needed" is a scope judgement, and an agent that could
 * make it about a merge would have walked around the gate by relabelling it — the refusal would be
 * intact and useless. A human may skip anything, because a human is who the gate escalates to.
 */
export function agentMaySkip(
  stage: WorkflowStage,
  policies: readonly AutonomyPolicy[],
  stats: GateTrackRecord | null = null
): boolean {
  return gateReasonFor(stage, policies, stats) === null
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
