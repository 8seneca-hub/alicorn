import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { startOutboxRetention } from './outbox-retention'

// Fixed instant so "N days ago" is deterministic; matches sqlite's own
// datetime('now') text shape ('YYYY-MM-DD HH:MM:SS') for correct string comparison.
const NOW_MS = new Date('2026-09-07T12:00:00.000Z').getTime()

function daysAgoSqlite(days: number): string {
  return new Date(NOW_MS - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
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
})
