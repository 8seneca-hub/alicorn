import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('ledger outbox methods', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('enqueues a new item and lists it as due', () => {
    const result = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-1',
      payload: { foo: 'bar' }
    })

    expect(result.duplicate).toBe(false)
    const due = db.listDueLedgerOutbox()
    expect(due).toHaveLength(1)
    expect(due[0].id).toBe(result.id)
    expect(due[0].kind).toBe('step_outcome')
    expect(JSON.parse(due[0].payload)).toEqual({ foo: 'bar' })
  })

  it('ignores a second enqueue with the same dedupe key and keeps one row', () => {
    const first = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-1',
      payload: { attempt: 1 }
    })
    const second = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-1',
      payload: { attempt: 2 }
    })

    expect(second.duplicate).toBe(true)
    expect(second.id).toBe(first.id)
    expect(db.listDueLedgerOutbox()).toHaveLength(1)
  })

  it('excludes items whose not_before is in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    db.enqueueLedgerOutbox({
      kind: 'context_capture',
      dedupeKey: 'context_capture:dispatch-2',
      payload: {},
      notBefore: future
    })

    expect(db.listDueLedgerOutbox()).toHaveLength(0)
    expect(db.listDueLedgerOutbox(25, future)).toHaveLength(1)
  })

  it('marks an item sent so it drops out of the due list', () => {
    const { id } = db.enqueueLedgerOutbox({
      kind: 'spend_attribution',
      dedupeKey: 'spend_attribution:dispatch-3',
      payload: {}
    })

    db.markLedgerOutboxSent(id)

    expect(db.listDueLedgerOutbox()).toHaveLength(0)
  })

  it('increments attempts and hides the row until retryAt on failure', () => {
    const { id } = db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:dispatch-4:qa',
      payload: {}
    })
    const retryAt = new Date(Date.now() + 60_000).toISOString()

    db.markLedgerOutboxFailed(id, 'network error', retryAt)

    expect(db.listDueLedgerOutbox()).toHaveLength(0)
    const row = db.listDueLedgerOutbox(25, retryAt)[0]
    expect(row.attempts).toBe(1)
    expect(row.last_error).toBe('network error')
    expect(row.not_before).toBe(retryAt)
  })
})
