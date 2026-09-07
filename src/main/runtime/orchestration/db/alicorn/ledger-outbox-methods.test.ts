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

  it('excludes a dead row from the due list', () => {
    const { id } = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-5',
      payload: {}
    })

    db.markLedgerOutboxDead(id, 'permanent rejection: 422 unprocessable')

    expect(db.listDueLedgerOutbox()).toHaveLength(0)
  })

  it('filters the due list to only the given kinds', () => {
    db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'step_outcome:a', payload: {} })
    db.enqueueLedgerOutbox({ kind: 'interruption', dedupeKey: 'interruption:b', payload: {} })

    const due = db.listDueLedgerOutbox(25, undefined, { kinds: ['interruption'] })

    expect(due).toHaveLength(1)
    expect(due[0].kind).toBe('interruption')
  })

  it('filters the due list to exclude the given kinds', () => {
    db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'step_outcome:c', payload: {} })
    db.enqueueLedgerOutbox({ kind: 'interruption', dedupeKey: 'interruption:d', payload: {} })

    const due = db.listDueLedgerOutbox(25, undefined, { excludeKinds: ['interruption'] })

    expect(due).toHaveLength(1)
    expect(due[0].kind).toBe('step_outcome')
  })

  it('requeues a dead row: due again with attempts and last_error reset', () => {
    const { id } = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-6',
      payload: { foo: 'bar' }
    })
    db.markLedgerOutboxFailed(id, 'network error', new Date(Date.now() + 60_000).toISOString())
    db.markLedgerOutboxDead(id, 'permanent rejection: 422 unprocessable')

    expect(db.requeueLedgerOutbox(id)).toBe(true)

    const due = db.listDueLedgerOutbox()
    expect(due).toHaveLength(1)
    expect(due[0].attempts).toBe(0)
    expect(due[0].last_error).toBeNull()
    expect(due[0].not_before).toBeNull()
    expect(due[0].dead_at).toBeNull()
    expect(due[0].dead_reason).toBeNull()
    // Identity must survive a requeue: same dedupe key, same payload.
    expect(due[0].dedupe_key).toBe('step_outcome:dispatch-6')
    expect(JSON.parse(due[0].payload)).toEqual({ foo: 'bar' })
  })

  it('leaves an already-sent row untouched: markLedgerOutboxDead is a silent no-op', () => {
    const { id } = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-8',
      payload: {}
    })
    db.markLedgerOutboxSent(id)

    db.markLedgerOutboxDead(id, 'permanent rejection: 422 unprocessable')

    expect(db.countDeadLedgerOutbox()).toBe(0)
    const row = db.db.prepare('SELECT * FROM ledger_outbox WHERE id = ?').get(id) as {
      sent_at: string | null
      dead_at: string | null
      attempts: number
    }
    expect(row.sent_at).not.toBeNull()
    expect(row.dead_at).toBeNull()
    expect(row.attempts).toBe(0)
  })

  it('does not mark a dead row sent: guards a race between two processes on the same db', () => {
    const { id } = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-9',
      payload: {}
    })
    db.markLedgerOutboxDead(id, 'permanent rejection: 422 unprocessable')

    db.markLedgerOutboxSent(id)

    const row = db.db
      .prepare('SELECT sent_at, dead_at FROM ledger_outbox WHERE id = ?')
      .get(id) as {
      sent_at: string | null
      dead_at: string | null
    }
    expect(row.sent_at).toBeNull()
    expect(row.dead_at).not.toBeNull()
  })

  it('requeue returns false for a row that is not dead', () => {
    const { id } = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-7',
      payload: {}
    })

    expect(db.requeueLedgerOutbox(id)).toBe(false)
  })

  it('requeues all dead rows and returns how many changed', () => {
    const a = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'dead-x', payload: {} })
    const b = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'dead-y', payload: {} })
    const alive = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'alive-z',
      payload: {}
    })
    db.markLedgerOutboxDead(a.id, 'reason a')
    db.markLedgerOutboxDead(b.id, 'reason b')

    expect(db.requeueAllDeadLedgerOutbox()).toBe(2)
    expect(db.countDeadLedgerOutbox()).toBe(0)
    expect(
      db
        .listDueLedgerOutbox()
        .map((r) => r.id)
        .sort()
    ).toEqual([a.id, alive.id, b.id].sort())
  })

  it('requeues only dead rows of the given kind', () => {
    const outcome = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'dead-outcome',
      payload: {}
    })
    const interruption = db.enqueueLedgerOutbox({
      kind: 'interruption',
      dedupeKey: 'dead-interruption',
      payload: {}
    })
    db.markLedgerOutboxDead(outcome.id, 'reason')
    db.markLedgerOutboxDead(interruption.id, 'reason')

    expect(db.requeueAllDeadLedgerOutbox('interruption')).toBe(1)
    expect(db.countDeadLedgerOutbox()).toBe(1)
    expect(db.listDeadLedgerOutbox()[0].id).toBe(outcome.id)
  })

  it('lists dead rows and counts them', () => {
    const a = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'dead-a', payload: {} })
    const b = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'dead-b', payload: {} })
    db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'alive-c', payload: {} })

    db.markLedgerOutboxDead(a.id, 'reason a')
    db.markLedgerOutboxDead(b.id, 'reason b')

    expect(db.countDeadLedgerOutbox()).toBe(2)
    const dead = db.listDeadLedgerOutbox()
    expect(dead.map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
    expect(dead.every((r) => r.dead_at !== null)).toBe(true)
  })
})
