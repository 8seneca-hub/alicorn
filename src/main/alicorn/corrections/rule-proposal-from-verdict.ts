import { ControlPlaneRequestError } from '../control-plane-http'
import type { RuleProposalInput } from '../../../shared/alicorn/rule-proposals'
import type { HumanVerdictOutboxPayload } from './human-verdict-outbox-payload'

// 401/403 excluded deliberately: those mean auth is misconfigured, not that this payload is bad —
// the same split `classifyOutboxFailure` makes for the row as a whole.
function isPermanentlyRejected(error: unknown): boolean {
  return (
    error instanceof ControlPlaneRequestError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 403
  )
}

/**
 * RB1. A rejected or amended step is a finding a human paid for by hand, so the same row that
 * records the verdict also proposes a standing rule on the member that earned it. Both calls are
 * idempotent (`already_set`; unique on the outcome id), so a retry after either one lands is safe.
 */
export async function proposeRuleForVerdict(
  payload: HumanVerdictOutboxPayload,
  proposeRule: ((input: RuleProposalInput) => Promise<unknown>) | null | undefined,
  warn: (message: string, detail: Record<string, unknown>) => void
): Promise<void> {
  if (!proposeRule || !payload.memberId) {
    return
  }
  if (payload.humanVerdict !== 'amended' && payload.humanVerdict !== 'rejected') {
    return
  }
  try {
    await proposeRule({
      memberId: payload.memberId,
      outcomeId: payload.outcomeId,
      verdict: payload.humanVerdict,
      context: payload.ruleContext ?? {}
    })
  } catch (error) {
    // A permanently rejected proposal (a deleted member, a payload this server will never take)
    // must not dead-letter the verdict row: the measurement already landed, and the ledger is
    // what this row exists for. Anything transient still throws and is retried with it.
    if (isPermanentlyRejected(error)) {
      warn('[ledger-outbox] rule proposal rejected', {
        outcomeId: payload.outcomeId,
        memberId: payload.memberId,
        code: (error as ControlPlaneRequestError).code
      })
      return
    }
    throw error
  }
}
