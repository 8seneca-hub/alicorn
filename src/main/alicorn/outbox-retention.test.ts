import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { toSqliteUtc } from './run-usage-attribution'
import { startOutboxRetention } from './outbox-retention'

// Fixed instant so "N days ago" is deterministic.
const NOW_MS = new Date('2026-09-07T12:00:00.000Z').getTime()

// Why the shared formatter and not a local copy: if sqlite's stored shape ever widens, a private
// copy here would keep fabricating the old form and the cutoff comparison would silently stop
// matching -- a green test over a broken sweep.
function daysAgoSqlite(days: number): string {
  return toSqliteUtc(NOW_MS - days * 24 * 60 * 60 * 1000)
}

describe('outbox retention', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('deletes a sent row older than the retention window (31 days)', () => {
    const { id } = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'old', payload: {} })
    db.db.prepare('UPDATE ledger_outbox SET sent_at = ? WHERE id = ?').run(daysAgoSqlite(31), id)

    const retention = startOutboxRetention({ getDb: () => db, now: () => NOW_MS })
    const result = retention.sweepOnce()
    retention.stop()

    expect(result.deleted).toBe(1)
    expect(db.db.prepare('SELECT id FROM ledger_outbox WHERE id = ?').get(id)).toBeUndefined()
  })

  it('keeps a sent row within the retention window (29 days)', () => {
    const { id } = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'recent',
      payload: {}
    })
    db.db.prepare('UPDATE ledger_outbox SET sent_at = ? WHERE id = ?').run(daysAgoSqlite(29), id)

    const retention = startOutboxRetention({ getDb: () => db, now: () => NOW_MS })
    const result = retention.sweepOnce()
    retention.stop()

    expect(result.deleted).toBe(0)
    expect(db.db.prepare('SELECT id FROM ledger_outbox WHERE id = ?').get(id)).toBeDefined()
  })

  // The one that matters: a dead row is an operator signal, never garbage, no matter its age --
  // sent_at is also set here (the race markLedgerOutboxSent's own guard comment describes) so this
  // actually exercises the "AND dead_at IS NULL" clause, not just "sent_at IS NULL" falling through.
  it('keeps a dead row 400 days old even though it also carries an old sent_at', () => {
    const { id } = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'dead', payload: {} })
    db.markLedgerOutboxDead(id, 'permanent rejection: 422')
    db.db
      .prepare('UPDATE ledger_outbox SET sent_at = ?, dead_at = ? WHERE id = ?')
      .run(daysAgoSqlite(400), daysAgoSqlite(400), id)

    const retention = startOutboxRetention({ getDb: () => db, now: () => NOW_MS })
    const result = retention.sweepOnce()
    retention.stop()

    expect(result.deleted).toBe(0)
    const row = db.db.prepare('SELECT dead_at FROM ledger_outbox WHERE id = ?').get(id) as
      | { dead_at: string | null }
      | undefined
    // Why toBeDefined() first: on a deleted row `row` is undefined and `row?.dead_at` is too,
    // which would still satisfy not.toBeNull() -- the survival check has to assert the row exists.
    expect(row).toBeDefined()
    expect(row?.dead_at).not.toBeNull()
  })

  it('keeps a pending row (never sent) 400 days old', () => {
    const { id } = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'pending',
      payload: {}
    })
    db.db
      .prepare('UPDATE ledger_outbox SET created_at = ? WHERE id = ?')
      .run(daysAgoSqlite(400), id)

    const retention = startOutboxRetention({ getDb: () => db, now: () => NOW_MS })
    const result = retention.sweepOnce()
    retention.stop()

    expect(result.deleted).toBe(0)
    expect(db.db.prepare('SELECT id FROM ledger_outbox WHERE id = ?').get(id)).toBeDefined()
  })

  it('sweepOnce returns the deleted count and the three counts', () => {
    const sent = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'a', payload: {} })
    db.db
      .prepare('UPDATE ledger_outbox SET sent_at = ? WHERE id = ?')
      .run(daysAgoSqlite(31), sent.id)
    const kept = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'b', payload: {} })
    db.db
      .prepare('UPDATE ledger_outbox SET sent_at = ? WHERE id = ?')
      .run(daysAgoSqlite(29), kept.id)
    const dead = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'c', payload: {} })
    db.markLedgerOutboxDead(dead.id, 'permanent rejection: 422')
    db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'd', payload: {} })

    // Timer is not required for the assertions -- called directly, never via setInterval.
    const retention = startOutboxRetention({ getDb: () => db, now: () => NOW_MS })
    const result = retention.sweepOnce()
    retention.stop()

    expect(result).toEqual({ deleted: 1, counts: { pending: 1, sent: 1, dead: 1 } })
  })

  // Why this matters more than the interval: a desktop session quit daily never reaches t+24h,
  // so without a leading sweep retention would never run once for the common usage pattern.
  it('sweeps shortly after start without waiting for the daily interval', () => {
    vi.useFakeTimers()
    try {
      const { id } = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'old', payload: {} })
      db.db.prepare('UPDATE ledger_outbox SET sent_at = ? WHERE id = ?').run(daysAgoSqlite(31), id)

      const retention = startOutboxRetention({
        getDb: () => db,
        now: () => NOW_MS,
        startDelayMs: 30_000
      })
      expect(db.db.prepare('SELECT id FROM ledger_outbox WHERE id = ?').get(id)).toBeDefined()

      vi.advanceTimersByTime(30_000)
      retention.stop()

      expect(db.db.prepare('SELECT id FROM ledger_outbox WHERE id = ?').get(id)).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop() cancels the leading sweep before it fires', () => {
    vi.useFakeTimers()
    try {
      const { id } = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'old', payload: {} })
      db.db.prepare('UPDATE ledger_outbox SET sent_at = ? WHERE id = ?').run(daysAgoSqlite(31), id)

      const retention = startOutboxRetention({
        getDb: () => db,
        now: () => NOW_MS,
        startDelayMs: 30_000
      })
      retention.stop()
      vi.advanceTimersByTime(60_000)

      expect(db.db.prepare('SELECT id FROM ledger_outbox WHERE id = ?').get(id)).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
