import type { AutonomyPolicy, GateDecision, GateStep, TrackRecord } from './gate-policy'

/** ARCHITECTURE §7's level 3 — *Autonomous*: notifies instead of blocking. */
export const RETIREMENT_LEVEL = 3

/**
 * Why a gate was not retired. Every one of these is a *reason to keep gating*, which is why the
 * function returns one on every non-retirement path rather than a bare `false`: a gate that came
 * back must be able to say why, and "the record regressed" and "this stage can never retire" are
 * not the same answer to the human who is being interrupted.
 */
export const RETIREMENT_REFUSALS = [
  'hard-stop:irreversible',
  'hard-stop:inherited',
  'policy',
  'stage-key-unauthored',
  'demoted',
  'not-earned',
  'no-record',
  'level'
] as const
export type RetirementRefusal = (typeof RETIREMENT_REFUSALS)[number]

export type GateRetirement =
  | { retire: true; level: typeof RETIREMENT_LEVEL }
  | { retire: false; refusal: RetirementRefusal }

export type GateRetirementInput = {
  step: GateStep
  policy: AutonomyPolicy
  /** What `evaluateGate` decided. Retirement never re-derives it — one verdict, not two. */
  decision: GateDecision
  trackRecord: Pick<TrackRecord, 'level' | 'recentRegression'> | null
  /** From `resolveStageKey`. A window keyed on free text is measured, never trusted. */
  stageKeyAuthored: boolean
}

/**
 * Should this gate be retired — resolved by the policy instead of blocking a human (SK1)?
 *
 * This is the *only* place a gate stops interrupting, and it is deliberately a second, narrower
 * question than `evaluateGate`'s. `evaluateGate` answers "would the policy have gated?"; a level-0
 * stage records that answer and still gates, which is how a level is ever earned. This answers
 * "has this stage earned the right to skip the interruption?", and it says no far more often.
 *
 * The order is the contract:
 *
 * 1. **Hard stops are checked here too, first, and independently of `evaluateGate`.** They are
 *    already unreachable through `decision` — an irreversible step never returns `auto` — and that
 *    is exactly why they are repeated: the invariant is that merge and deploy gate regardless of
 *    track record, and an invariant that holds only because some other function happens to order
 *    its branches correctly is one refactor away from not holding. A perfect 500-run record does
 *    not retire an irreversible stage.
 * 2. An `always_gate` policy is a standing instruction, not evidence to be outweighed.
 * 3. An unauthored stage key cannot retire. Free-text `--phase` is still recorded and still
 *    measured; it is simply not a window anything may be earned in, because the member being
 *    judged chose it.
 * 4. **Demotion outranks everything a record can say, and is reported on its own.** The asymmetry
 *    is the point: level 3 costs 50 runs at a 0.95 accept rate with no amendment in 20, and one
 *    rejection — or two amendments — inside the last ten takes it back immediately. It is checked
 *    ahead of the decision because a demoted stage fails `evaluateGate` too, and reporting that
 *    generic failure would hide the specific one.
 * 5. Only a fully earned `auto` retires. A `never_gate` exception also decides `auto`, and it is
 *    deliberately excluded: an exception buys a project out of the *evidence* checks, and reading
 *    it as evidence would let a project author its own autonomy.
 *
 * The whole path is inert until a real record exists. Nothing here retires anything on a record
 * shorter than 50 runs, and nothing retires at all until a human verdict has been observed, since
 * `computeAutonomyLevel` caps an uncorrected record at level 1.
 */
export function resolveGateRetirement(input: GateRetirementInput): GateRetirement {
  const { step, policy, decision, trackRecord } = input

  if (step.reversibility === 'irreversible') {
    return refuse('hard-stop:irreversible')
  }
  if (step.inheritedCost === 'high') {
    return refuse('hard-stop:inherited')
  }
  if (policy.mode === 'always_gate') {
    return refuse('policy')
  }
  if (!input.stageKeyAuthored) {
    return refuse('stage-key-unauthored')
  }
  // Ahead of `not-earned` on purpose. A demoted stage also fails `evaluateGate` (on `regression`),
  // so checking the decision first would report every returned gate as the generic "the policy
  // gated" and the one thing the human needs — it came back, and this is why — would be invisible.
  if (trackRecord?.recentRegression === true) {
    return refuse('demoted')
  }
  if (decision.decision !== 'auto' || decision.reason !== 'auto') {
    return refuse('not-earned')
  }
  if (trackRecord === null) {
    return refuse('no-record')
  }
  if (trackRecord.level < RETIREMENT_LEVEL) {
    return refuse('level')
  }
  return { retire: true, level: RETIREMENT_LEVEL }
}

function refuse(refusal: RetirementRefusal): GateRetirement {
  return { retire: false, refusal }
}
