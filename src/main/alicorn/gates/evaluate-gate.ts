import { hasPolicyExpired } from '../../../shared/alicorn/gate-policy'
import type {
  AutonomyPolicy,
  GateDecision,
  GateDecisionReason,
  GateEvidence,
  GateStep
} from '../../../shared/alicorn/gate-policy'

/**
 * ARCHITECTURE §7's autonomy policy, as a pure function.
 *
 * The order is the contract, not an implementation detail: hard stops are checked before anything
 * a track record could influence, so accumulated evidence can never retire a gate protecting
 * something irreversible. `never_gate` sits *after* the two hard stops for the same reason — a
 * standing exception buys a project out of the evidence checks, never out of a production deploy.
 *
 * Unknown evidence is not permission. Every `null` below resolves to a gate, because the three
 * ways a field goes null in practice — an SSH host out of contact, a folder workspace with no
 * diff, a control plane that is down — are exactly the situations where guessing is worst.
 */
export function evaluateGate(
  step: GateStep,
  policy: AutonomyPolicy,
  evidence: GateEvidence,
  options?: { now?: () => number }
): GateDecision {
  const now = options?.now ?? Date.now

  if (policy.mode === 'always_gate') {
    return gate('policy')
  }

  // Hard stops. Authored on the stage, never inferred, and never retired by evidence.
  if (step.reversibility === 'irreversible') {
    return gate('irreversible')
  }
  if (step.inheritedCost === 'high') {
    return gate('inherited')
  }

  // An exception that has lapsed is not an exception; the policy falls back to `evidence`.
  if (policy.mode === 'never_gate' && !hasPolicyExpired(policy.expiresAt, now())) {
    return { decision: 'auto', reason: 'never_gate' }
  }

  if (evidence.allRequiredChecksPassed !== true) {
    return gate('unverified')
  }

  // BR1's budgets, and level 2's guard rail: nothing may reach level 2 without passing through
  // them. `maxFiles` and `maxSpendCents` are opt-in ceilings — an unauthored budget skips its
  // check — but the reach test below is not, so a project can never be handed unattended autonomy
  // over a protected path by simply not authoring a number. Every value here is the *run's*,
  // accumulated across its tasks, because a per-task budget is laundered by decomposition.
  if (policy.maxFiles !== null) {
    if (evidence.filesChanged === null || evidence.filesChanged > policy.maxFiles) {
      return gate('blast:files')
    }
  }
  if (policy.maxSpendCents !== null) {
    if (evidence.spendCents === null || evidence.spendCents > policy.maxSpendCents) {
      return gate('blast:spend')
    }
  }
  // Unknown reach reads as `unverified`, not `blast:reach`: nothing was found to have been
  // touched, we simply could not look, and the reason should say which of the two happened.
  if (evidence.touchedProtectedPath === null) {
    return gate('unverified')
  }
  if (evidence.touchedProtectedPath) {
    return gate('blast:reach')
  }

  const stats = evidence.stats
  if (stats === null || stats.runs < policy.minRuns) {
    return gate('history')
  }
  if (stats.acceptRate < policy.minAcceptRate) {
    return gate('accept-rate')
  }
  if (stats.recentRegression) {
    return gate('regression')
  }

  return { decision: 'auto', reason: 'auto' }
}

function gate(reason: GateDecisionReason): GateDecision {
  return { decision: 'gate', reason }
}
