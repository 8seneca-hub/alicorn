import { translate } from '@/i18n/i18n'
import type { ProvenanceGateView } from '../../../../../shared/alicorn/provenance-view'

/** Badge classes matching RUN_STATUS_COLOR's tinted-outline shape, so the two Alicorn panels read alike. */
export const GATE_DECISION_COLOR: Record<ProvenanceGateView['decision'], string> = {
  auto: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  gate: 'bg-amber-500/15 text-amber-500 border-amber-500/20',
  unknown: 'bg-muted text-muted-foreground/70 border-border'
}

export function gateDecisionLabel(decision: ProvenanceGateView['decision']): string {
  if (decision === 'auto') {
    return translate(
      'auto.components.right.sidebar.provenance.panel.gate.decision.auto',
      'No human asked'
    )
  }
  if (decision === 'gate') {
    return translate(
      'auto.components.right.sidebar.provenance.panel.gate.decision.gate',
      'Human asked'
    )
  }
  return translate(
    'auto.components.right.sidebar.provenance.panel.gate.decision.unknown',
    'Not recorded'
  )
}

/**
 * The sentence PV1 exists for. Every branch names the *authored* rule that produced the decision —
 * GP1's `evaluateGate` order — rather than restating the enum, because a developer reading this
 * has to be able to go and change the thing that decided.
 */
// Takes only what it reads: a caller rendering a recommendation has a decision and a reason,
// not a whole recorded gate.
export function gateReasonSentence(gate: Pick<ProvenanceGateView, 'decision' | 'reason'>): string {
  if (gate.decision === 'unknown' || gate.reason === 'unknown') {
    return translate(
      'auto.components.right.sidebar.provenance.panel.gate.reason.unknown',
      'This step was recorded without a gate decision, so the ledger cannot say whether a human was asked or why.'
    )
  }
  switch (gate.reason) {
    case 'auto':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.auto',
        'Every condition passed: the required checks were green, the change stayed inside the policy’s blast-radius budget, and this member’s track record on this stage cleared the bar.'
      )
    case 'never_gate':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.never.gate',
        'A standing never-gate exception for this stage was in force and had not expired. It buys the stage out of the evidence checks, never out of a hard stop.'
      )
    case 'policy':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.policy',
        'The policy for this stage is always-gate, so a human is asked no matter what the track record says.'
      )
    case 'irreversible':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.irreversible',
        'The stage is authored irreversible. That is a hard stop: accumulated evidence never retires it.'
      )
    case 'inherited':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.inherited',
        'The stage carries a high inherited cost. That is a hard stop: accumulated evidence never retires it.'
      )
    case 'unverified':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.unverified',
        'A required check had not passed, or its result could not be read. Unknown is not permission.'
      )
    case 'blast:files':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.blast.files',
        'More files changed than the policy’s file budget allows — or the count could not be read.'
      )
    case 'blast:spend':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.blast.spend',
        'Spend went past the policy’s budget for this stage — or the step ran on a backend Alicorn cannot price.'
      )
    case 'blast:reach':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.blast.reach',
        'The change touched a protected path.'
      )
    case 'history':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.history',
        'This member has not run this stage often enough to meet the policy’s minimum. Autonomy is unlocked by evidence, and evidence only accumulates by running gated.'
      )
    case 'accept-rate':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.accept.rate',
        'This member’s accept rate on this stage is below the policy’s minimum.'
      )
    case 'regression':
      return translate(
        'auto.components.right.sidebar.provenance.panel.gate.reason.regression',
        'A recent regression on this stage put the member back behind the gate.'
      )
  }
}
