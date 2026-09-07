import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { LedgerOutboxRow } from '../runtime/orchestration/db/alicorn/alicorn-rows'
import { classifyOutboxFailure } from './outbox-failure-policy'

const BASE_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 5 * 60_000

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempts)
}

export type RowOutcome = { kind: 'sent' } | { kind: 'failed'; error: unknown }

/**
 * The single place a row is marked sent, failed or dead, so the drainer and the
 * worker (Task 4) can't drift apart on retry-vs-dead-letter policy.
 */
export function settleOutboxRow(
  db: OrchestrationDb,
  row: LedgerOutboxRow,
  outcome: RowOutcome,
  deps: {
    now: () => number
    warn: (message: string, detail: Record<string, unknown>) => void
    throttledWarn: (message: string, detail: Record<string, unknown>) => void
  }
): 'sent' | 'retry' | 'dead' | 'stop_pass' {
  if (outcome.kind === 'sent') {
    db.markLedgerOutboxSent(row.id)
    return 'sent'
  }
  const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
  const decision = classifyOutboxFailure(outcome.error, row.attempts + 1)
  if (decision.action === 'retry') {
    db.markLedgerOutboxFailed(
      row.id,
      message,
      new Date(deps.now() + backoffMs(row.attempts)).toISOString()
    )
    deps.throttledWarn('[ledger-outbox] row failed', {
      id: row.id,
      kind: row.kind,
      attempts: row.attempts,
      message
    })
    return 'retry'
  }
  if (decision.action === 'dead') {
    db.markLedgerOutboxDead(row.id, decision.reason)
    deps.warn('[ledger-outbox] row dead', {
      id: row.id,
      kind: row.kind,
      attempts: row.attempts,
      reason: decision.reason
    })
    return 'dead'
  }
  deps.throttledWarn(decision.reason, { id: row.id, kind: row.kind })
  return 'stop_pass'
}
