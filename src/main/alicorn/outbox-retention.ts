import type { OrchestrationDb } from '../runtime/orchestration/db'
import { toSqliteUtc } from './run-usage-attribution'

export const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const OUTBOX_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000
// Why a leading sweep at all: setInterval(24h) first fires at t+24h, and a desktop session
// that is quit daily -- or restarted by an auto-update -- never reaches it, so retention
// would never run once for the common usage pattern. Deferred so it misses first paint.
export const OUTBOX_RETENTION_START_DELAY_MS = 30_000

type OutboxCounts = { pending: number; sent: number; dead: number }

export type OutboxRetentionDeps = {
  getDb: () => OrchestrationDb | null
  intervalMs?: number
  startDelayMs?: number
  now?: () => number
}

export type OutboxRetention = {
  stop: () => void
  sweepOnce: () => { deleted: number; counts: OutboxCounts }
}

/** Daily sweep (LG3): delivered outbox rows expire after 30 days; dead and pending rows never do. */
export function startOutboxRetention(deps: OutboxRetentionDeps): OutboxRetention {
  const now = deps.now ?? Date.now

  function sweepOnce(): { deleted: number; counts: OutboxCounts } {
    const db = deps.getDb()
    if (!db) {
      return { deleted: 0, counts: { pending: 0, sent: 0, dead: 0 } }
    }
    const cutoff = toSqliteUtc(now() - OUTBOX_RETENTION_MS)
    const deleted = db.deleteSentLedgerOutboxBefore(cutoff)
    const counts = db.countLedgerOutbox()
    // Why log the counts and not just deletions: a misconfigured ledger URL parks every row in
    // `pending` without ever dead-lettering, so `deadCount: 0` reads healthy while the queue grows
    // unboundedly. The pending figure is the only signal that says otherwise.
    if (deleted > 0 || counts.pending > 0) {
      console.log(
        `[outbox-retention] deleted ${deleted} delivered row(s) past the 30-day window; ` +
          `pending ${counts.pending}, sent ${counts.sent}, dead ${counts.dead}`
      )
    }
    return { deleted, counts }
  }

  function guardedSweep(): void {
    try {
      sweepOnce()
    } catch (error) {
      console.error('[outbox-retention] sweep failed:', error)
    }
  }

  const intervalMs = deps.intervalMs ?? OUTBOX_RETENTION_INTERVAL_MS
  const leadingTimer = setTimeout(
    guardedSweep,
    deps.startDelayMs ?? OUTBOX_RETENTION_START_DELAY_MS
  )
  const timer = setInterval(guardedSweep, intervalMs)

  return {
    stop() {
      clearTimeout(leadingTimer)
      clearInterval(timer)
    },
    sweepOnce
  }
}
