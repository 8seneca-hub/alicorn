import { getLatestDispatchForTask } from '../../runtime/orchestration/db/dispatch-context/task-dispatch-reconciliation'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { DecisionGateRow } from '../../runtime/orchestration/types'
import type { GateAgreementPatch } from '../../../shared/alicorn/ledger-inputs'

/** The two words a gate verdict is spoken in — the policy's and the human's alike. */
export const GATE_VERDICTS = ['gate', 'auto'] as const
export type GateVerdict = (typeof GATE_VERDICTS)[number]

export function isGateVerdict(value: unknown): value is GateVerdict {
  return value === 'gate' || value === 'auto'
}

/**
 * What GP3 measures: did the human's own call on the gate match what the policy would have done?
 *
 * Not the human verdict. `human_verdict` says what a human later did to the *work* — accepted it,
 * amended it, reverted it — and the corrections sweep writes it hours afterwards. This says
 * whether the *interruption* was warranted, and only the person being interrupted can answer it.
 * Collapsing the two would make an amended-but-correctly-gated step look like a policy failure.
 */
export function gateAgreementPatch(
  gate: Pick<DecisionGateRow, 'id' | 'recommended_decision' | 'recommended_reason'>,
  human: { decision: GateVerdict; recommendationShown: boolean }
): GateAgreementPatch | null {
  // No recommendation means the policy was never asked (a gate opened without `evaluate`), so
  // there is nothing to agree or disagree with. Recording one anyway would invent evidence.
  if (!isGateVerdict(gate.recommended_decision)) {
    return null
  }
  return {
    gateId: gate.id,
    policyRecommendation: gate.recommended_decision,
    policyRecommendationReason: gate.recommended_reason ?? 'auto',
    humanGateDecision: human.decision,
    recommendationShown: human.recommendationShown
  }
}

export type GateAgreementOutboxPayload = GateAgreementPatch & { dispatchId: string }

/**
 * Enqueues the agreement through the outbox — never a direct fetch from the resolve path, and
 * never on a step whose outcome has not settled: the payload names the dispatch and the drainer
 * resolves it to a ledger outcome id when it sends, exactly as the corrections sweep does.
 *
 * Returns the number of rows enqueued (0 or 1). Never throws: measuring the policy must not be
 * able to fail resolving a gate.
 */
export function enqueueGateAgreement(
  db: OrchestrationDb,
  gate: DecisionGateRow,
  human: { decision: GateVerdict; recommendationShown: boolean }
): number {
  try {
    const patch = gateAgreementPatch(gate, human)
    if (!patch) {
      return 0
    }
    // The task is blocked while its gate is pending, so no dispatch can start in between: the
    // newest dispatch is still the one the gate was opened about.
    const dispatch = getLatestDispatchForTask(db, gate.task_id)
    if (!dispatch) {
      return 0
    }
    const payload: GateAgreementOutboxPayload = { ...patch, dispatchId: dispatch.id }
    const { duplicate } = db.enqueueLedgerOutbox({
      // Keyed on the gate, not the dispatch: a gate resolves once, and one dispatch can raise
      // several gates whose agreements must not collapse into one row.
      kind: 'gate_agreement_patch',
      dedupeKey: `gate_agreement:${gate.id}`,
      payload
    })
    return duplicate ? 0 : 1
  } catch (error) {
    console.warn(
      '[alicorn] gate agreement not recorded',
      gate.id,
      error instanceof Error ? error.message : String(error)
    )
    return 0
  }
}
