/**
 * Does a track record clear the bar a project authored?
 *
 * Extracted so the two places that ask — `evaluateGate` for a dispatch, `gateReasonFor` for a stage
 * advance — read one rule. Two implementations that could disagree about whether a member has
 * earned its autonomy would be worse than none, because the ledger is the only evidence either has.
 *
 * A null record is a shortfall, not a pass: `minRuns: 0` says "no runs required", never "no ledger
 * required". Unknown evidence is not permission.
 */
import type { AutonomyPolicy, GateTrackRecord } from './gate-policy'

export type EvidenceShortfall = 'history' | 'accept-rate' | 'regression'

export function evidenceShortfall(
  policy: Pick<AutonomyPolicy, 'minRuns' | 'minAcceptRate'>,
  stats: GateTrackRecord | null
): EvidenceShortfall | null {
  if (stats === null || stats.runs < policy.minRuns) {
    return 'history'
  }
  if (stats.acceptRate < policy.minAcceptRate) {
    return 'accept-rate'
  }
  if (stats.recentRegression) {
    return 'regression'
  }
  return null
}

/** What the stage stands at against its bar — "4 of 10 runs, 92% accepted". */
export function describeEvidenceProgress(
  policy: Pick<AutonomyPolicy, 'minRuns' | 'minAcceptRate'>,
  stats: GateTrackRecord | null
): string {
  const runs = stats?.runs ?? 0
  const rate = Math.round((stats?.acceptRate ?? 0) * 100)
  return `${runs} of ${policy.minRuns} runs, ${rate}% accepted`
}
