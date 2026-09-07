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
 * The single place a row is marked failed or dead, and sent for every kind except
 * step_outcome — the drainer's handleStepOutcome marks that one sent inside its own
 * transaction instead (LH-R2), because that transaction also enqueues the step's
 * follow-up rows and both writes must commit or roll back together.
 */
export function settleOutboxRow(
  db: OrchestrationDb,
  row: LedgerOutboxRow,
  outcome: RowOutcome,
  deps: {
    now: () => number
    warn: (message: string, detail: Record<string, unknown>) => void
    throttledWarn: (
      message: string,
      detail: Record<string, unknown>,
      options?: { force?: boolean }
    ) => void
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
    // Why force on the first failure: nothing has warned about this row yet, so the
    // shared throttle window must not hide it (explicit, rather than the caller
    // inferring "first" from an attempts field it happens to find in detail).
    deps.throttledWarn(
      '[ledger-outbox] row failed',
      { id: row.id, kind: row.kind, attempts: row.attempts, message },
      { force: row.attempts === 0 }
    )
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
  deps.throttledWarn(decision.message, { id: row.id, kind: row.kind })
  return 'stop_pass'
}
