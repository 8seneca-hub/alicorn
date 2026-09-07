import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import type { LedgerOutboxRow } from '../runtime/orchestration/db/alicorn/alicorn-rows'
import { settleOutboxRow } from './outbox-row-processing'
import { ControlPlaneRequestError, ControlPlaneUnavailableError } from './control-plane-http'
import { MAX_OUTBOX_ATTEMPTS } from './outbox-failure-policy'

describe('settleOutboxRow', () => {
  let db: OrchestrationDb
  let warn: (message: string, detail: Record<string, unknown>) => void
  let throttledWarn: (message: string, detail: Record<string, unknown>) => void

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    warn = vi.fn()
    throttledWarn = vi.fn()
  })

  afterEach(() => {
    db.close()
  })

  function enqueue(): LedgerOutboxRow {
    db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:row-1',
      payload: {}
    })
    return db.listDueLedgerOutbox()[0]
  }

  function deps(now = Date.now()) {
    return { now: () => now, warn, throttledWarn }
  }

  it('marks the row sent and reports "sent"', () => {
    const row = enqueue()

    const result = settleOutboxRow(db, row, { kind: 'sent' }, deps())

    expect(result).toBe('sent')
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
    expect(throttledWarn).not.toHaveBeenCalled()
  })

  it('retries a transient failure, bumping attempts and scheduling a backoff retry', () => {
    const row = enqueue()
    const now = Date.now()

    const result = settleOutboxRow(
      db,
      row,
      { kind: 'failed', error: new ControlPlaneRequestError(500, 'server_error') },
      deps(now)
    )

    expect(result).toBe('retry')
    const farFuture = new Date(now + 10 * 60_000).toISOString()
    const due = db.listDueLedgerOutbox(25, farFuture)[0]
    expect(due.attempts).toBe(1)
    expect(due.last_error).toBe('500 server_error')
    expect(new Date(due.not_before!).getTime()).toBeGreaterThan(now)
    expect(throttledWarn).toHaveBeenCalledWith(
      '[ledger-outbox] row failed',
      { id: row.id, kind: 'step_outcome', attempts: 0, message: '500 server_error' },
      { force: true }
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not force a warn on a later retry of the same row', () => {
    const row = enqueue()
    db.markLedgerOutboxFailed(row.id, 'network error', new Date(0).toISOString())
    const retried = db.listDueLedgerOutbox()[0]

    settleOutboxRow(
      db,
      retried,
      { kind: 'failed', error: new ControlPlaneRequestError(500, 'server_error') },
      deps()
    )

    expect(throttledWarn).toHaveBeenCalledWith(
      '[ledger-outbox] row failed',
      expect.objectContaining({ attempts: 1 }),
      { force: false }
    )
  })

  it('dead-letters a permanently rejected row with a single "row dead" warn', () => {
    const row = enqueue()

    const result = settleOutboxRow(
      db,
      row,
      { kind: 'failed', error: new ControlPlaneRequestError(404, 'not_found') },
      deps()
    )

    expect(result).toBe('dead')
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
    expect(db.countDeadLedgerOutbox()).toBe(1)
    expect(db.listDeadLedgerOutbox()[0].dead_reason).toBe('404 not_found')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[ledger-outbox] row dead', {
      id: row.id,
      kind: 'step_outcome',
      attempts: 0,
      reason: '404 not_found'
    })
    expect(throttledWarn).not.toHaveBeenCalled()
  })

  it('dead-letters once the attempt budget is exhausted', () => {
    const row = enqueue()
    for (let i = 0; i < MAX_OUTBOX_ATTEMPTS - 1; i++) {
      db.markLedgerOutboxFailed(row.id, 'network error', new Date(0).toISOString())
    }
    const nearLimit = db.listDueLedgerOutbox()[0]
    expect(nearLimit.attempts).toBe(MAX_OUTBOX_ATTEMPTS - 1)

    const result = settleOutboxRow(
      db,
      nearLimit,
      { kind: 'failed', error: new Error('boom') },
      deps()
    )

    expect(result).toBe('dead')
    expect(db.listDeadLedgerOutbox()[0].dead_reason).toBe('max_attempts')
  })

  it('stops the pass on a control-plane-unconfigured failure without writing to the row', () => {
    const row = enqueue()

    const result = settleOutboxRow(
      db,
      row,
      { kind: 'failed', error: new ControlPlaneUnavailableError() },
      deps()
    )

    expect(result).toBe('stop_pass')
    const untouched = db.listDueLedgerOutbox()[0]
    expect(untouched.attempts).toBe(0)
    expect(untouched.last_error).toBeNull()
    expect(untouched.not_before).toBeNull()
    expect(throttledWarn).toHaveBeenCalledWith(
      '[ledger-outbox] control plane unconfigured; row untouched',
      expect.any(Object)
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('stops the pass on a 403, mentioning unauthorized, without writing to the row', () => {
    const row = enqueue()

    const result = settleOutboxRow(
      db,
      row,
      { kind: 'failed', error: new ControlPlaneRequestError(403, 'forbidden') },
      deps()
    )

    expect(result).toBe('stop_pass')
    const untouched = db.listDueLedgerOutbox()[0]
    expect(untouched.attempts).toBe(0)
    expect(throttledWarn).toHaveBeenCalledWith(
      '[ledger-outbox] control plane unauthorized; row untouched',
      expect.any(Object)
    )
    expect(warn).not.toHaveBeenCalled()
  })
})
