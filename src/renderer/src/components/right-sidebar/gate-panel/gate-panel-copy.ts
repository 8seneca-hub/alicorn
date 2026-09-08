import { translate } from '@/i18n/i18n'
import type { GateVerdict } from '../../../../../shared/alicorn/gate-review'

/** Tinted-outline badges matching the provenance panel, so the two Alicorn surfaces read alike. */
export const GATE_VERDICT_COLOR: Record<GateVerdict, string> = {
  auto: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  gate: 'bg-amber-500/15 text-amber-500 border-amber-500/20'
}

/**
 * What the *policy* would have done, said as an action rather than as a verdict on the human.
 * Phrasing matters here: "the policy was right" invites agreement, "the policy would have X"
 * leaves the human to make their own call, which is the only call worth measuring.
 */
export function policyWouldHaveSentence(decision: GateVerdict): string {
  return decision === 'auto'
    ? translate(
        'auto.components.right.sidebar.gate.panel.policy.would.auto',
        'The policy would have let this step proceed without asking you.'
      )
    : translate(
        'auto.components.right.sidebar.gate.panel.policy.would.gate',
        'The policy would have stopped here and asked you, which is what happened.'
      )
}

/** The human's own call, in the same two words the policy speaks so the two can be compared. */
export function humanVerdictLabel(decision: GateVerdict): string {
  return decision === 'auto'
    ? translate(
        'auto.components.right.sidebar.gate.panel.verdict.auto',
        'Could have proceeded'
      )
    : translate('auto.components.right.sidebar.gate.panel.verdict.gate', 'Needed me')
}
