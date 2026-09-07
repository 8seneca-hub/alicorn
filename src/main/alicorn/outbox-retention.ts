import type { OrchestrationDb } from '../runtime/orchestration/db'

export const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const OUTBOX_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000

type OutboxCounts = { pending: number; sent: number; dead: number }

export type OutboxRetentionDeps = {
  getDb: () => OrchestrationDb | null
  intervalMs?: number
  now?: () => number
}

export type OutboxRetention = {
  stop: () => void
  sweepOnce: () => { deleted: number; counts: OutboxCounts }
}

// SQLite's own datetime('now') format: 'YYYY-MM-DD HH:MM:SS', no ms, no zone marker --
// an ISO cutoff would compare wrong against it (space sorts below 'T') on same-day rows.
function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
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
    if (deleted > 0) {
      console.log(`[outbox-retention] deleted ${deleted} delivered row(s) past the 30-day window`)
    }
    return { deleted, counts: db.countLedgerOutbox() }
  }

  const intervalMs = deps.intervalMs ?? OUTBOX_RETENTION_INTERVAL_MS
  const timer = setInterval(() => {
    try {
      sweepOnce()
    } catch (error) {
      console.error('[outbox-retention] sweep failed:', error)
    }
  }, intervalMs)

  return {
    stop() {
      clearInterval(timer)
    },
    sweepOnce
  }
}
