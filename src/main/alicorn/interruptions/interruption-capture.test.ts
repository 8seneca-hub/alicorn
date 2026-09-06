import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'
import { reconcileLifecycleMessage } from '../../runtime/orchestration/lifecycle-reconciliation'
import {
  enqueueInterruptionsForDispatch,
  enqueueInterruptionsOnSettlement
} from './interruption-capture'

describe('enqueueInterruptionsForDispatch', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  function insertGate(id: string, taskId: string, runId: string, createdAt?: string): void {
    db.db
      .prepare(
        `INSERT INTO decision_gates (id, run_id, task_id, question${createdAt ? ', created_at' : ''})
         VALUES (?, ?, ?, ?${createdAt ? ', ?' : ''})`
      )
      .run(
        ...(createdAt
          ? [id, runId, taskId, 'pick one', createdAt]
          : [id, runId, taskId, 'pick one'])
      )
  }

  function interruptionRows(): {
    kind: string
    sourceId: string
    dedupeKey: string
    payload: unknown
  }[] {
    return db
      .listDueLedgerOutbox(50)
      .filter((row) => row.kind === 'interruption')
      .map((row) => ({
        kind: (JSON.parse(row.payload) as { kind: string }).kind,
        sourceId: (JSON.parse(row.payload) as { sourceId: string }).sourceId,
        dedupeKey: row.dedupe_key,
        payload: JSON.parse(row.payload)
      }))
  }

  it('records 2 gates, 1 ask and 1 escalation offer as 4 interruption rows', () => {
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')

    insertGate('gate_1', task.id, task.run_id)
    insertGate('gate_2', task.id, task.run_id)
    const { question } = db.createQuestion({
      runId: task.run_id,
      dispatchId: dispatch.id,
      askerHandle: 'term_worker',
      question: 'which approach?'
    })
    db.markEscalationOffered(task.id)
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: 'done'
    })

    const ids = { runId: task.run_id, taskId: task.id, dispatchId: dispatch.id }
    const count = enqueueInterruptionsForDispatch(db, ids)

    expect(count).toBe(4)
    const rows = interruptionRows()
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.kind).sort()).toEqual(['ask', 'escalation', 'gate', 'gate'])

    const gate1 = rows.find((r) => r.sourceId === 'gate_1')!
    expect(gate1).toMatchObject({ kind: 'gate', dedupeKey: 'interruption:gate:gate_1' })
    expect(gate1.payload).toMatchObject({
      runId: task.run_id,
      taskId: task.id,
      dispatchId: dispatch.id,
      resolvedBy: null
    })
    expect(() =>
      new Date((gate1.payload as { occurredAt: string }).occurredAt).toISOString()
    ).not.toThrow()

    const ask = rows.find((r) => r.kind === 'ask')!
    expect(ask.sourceId).toBe(question.message_id)
    expect(ask.dedupeKey).toBe(`interruption:ask:${question.message_id}`)

    const escalation = rows.find((r) => r.kind === 'escalation')!
    expect(escalation.sourceId).toBe(dispatch.id)
    expect(escalation.dedupeKey).toBe(`interruption:escalation:${dispatch.id}`)
  })

  it('re-running over the same dispatch enqueues no new rows', () => {
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    insertGate('gate_1', task.id, task.run_id)
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: 'done'
    })
    const ids = { runId: task.run_id, taskId: task.id, dispatchId: dispatch.id }

    expect(enqueueInterruptionsForDispatch(db, ids)).toBe(1)
    expect(enqueueInterruptionsForDispatch(db, ids)).toBe(0)
    expect(interruptionRows()).toHaveLength(1)
  })

  it('does not count a gate created outside the dispatch span', () => {
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    // Well before dispatched_at, which is stamped at dispatch creation just above.
    insertGate('gate_old', task.id, task.run_id, '2000-01-01 00:00:00')
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: 'done'
    })

    const count = enqueueInterruptionsForDispatch(db, {
      runId: task.run_id,
      taskId: task.id,
      dispatchId: dispatch.id
    })

    expect(count).toBe(0)
    expect(interruptionRows()).toHaveLength(0)
  })

  it('returns 0 when the dispatch has not settled (no completed_at yet)', () => {
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    insertGate('gate_1', task.id, task.run_id)

    const count = enqueueInterruptionsForDispatch(db, {
      runId: task.run_id,
      taskId: task.id,
      dispatchId: dispatch.id
    })

    expect(count).toBe(0)
    expect(interruptionRows()).toHaveLength(0)
  })

  it('returns 0 and never throws for an unknown dispatch id', () => {
    expect(
      enqueueInterruptionsForDispatch(db, {
        runId: 'run_missing',
        taskId: 'task_missing',
        dispatchId: 'ctx_missing'
      })
    ).toBe(0)
  })

  describe('wired into the lifecycle settlement hook', () => {
    it('enqueues interruptions when a real worker_done settles the dispatch', () => {
      const task = db.createTask({ spec: 'work' })
      const dispatch = createRootDispatch(db, task.id, 'term_worker')
      db.createQuestion({
        runId: task.run_id,
        dispatchId: dispatch.id,
        askerHandle: 'term_worker',
        question: 'which approach?'
      })
      db.markEscalationOffered(task.id)
      const message = db.insertMessage({
        from: 'term_worker',
        to: 'term_coordinator',
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded' })
      })

      expect(reconcileLifecycleMessage(db, message).action).toBe('completed')

      const rows = interruptionRows()
      expect(rows.map((r) => r.kind).sort()).toEqual(['ask', 'escalation'])
    })

    it('enqueues no rows when the worker_done report is rejected', () => {
      const message = db.insertMessage({
        from: 'term_worker',
        to: 'term_coordinator',
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({
          taskId: 'task_missing',
          dispatchId: 'ctx_missing',
          outcome: 'succeeded'
        })
      })

      expect(reconcileLifecycleMessage(db, message).action).toBe('rejected')
      expect(interruptionRows()).toHaveLength(0)
    })

    it('enqueues no additional rows on a duplicate worker_done settlement', () => {
      const task = db.createTask({ spec: 'work' })
      const dispatch = createRootDispatch(db, task.id, 'term_worker')
      db.markEscalationOffered(task.id)
      const first = db.insertMessage({
        from: 'term_worker',
        to: 'term_coordinator',
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded' })
      })
      expect(reconcileLifecycleMessage(db, first).action).toBe('completed')
      expect(interruptionRows()).toHaveLength(1)

      const replay = db.insertMessage({
        from: 'term_worker',
        to: 'term_coordinator',
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded' })
      })
      expect(reconcileLifecycleMessage(db, replay).action).toBe('completed')
      expect(interruptionRows()).toHaveLength(1)
    })
  })

  describe('enqueueInterruptionsOnSettlement', () => {
    it('captures on a settled, non-duplicate settlement', () => {
      const task = db.createTask({ spec: 'work' })
      const dispatch = createRootDispatch(db, task.id, 'term_worker')
      db.markEscalationOffered(task.id)
      db.settleWorkerReport({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: 'done'
      })

      const count = enqueueInterruptionsOnSettlement(
        db,
        { action: 'settled', outcome: 'succeeded', duplicate: false },
        { runId: task.run_id, taskId: task.id, dispatchId: dispatch.id }
      )

      expect(count).toBe(1)
    })

    it('skips a duplicate settlement', () => {
      expect(
        enqueueInterruptionsOnSettlement(
          db,
          { action: 'settled', outcome: 'succeeded', duplicate: true },
          { runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1' }
        )
      ).toBe(0)
    })

    it('skips a rejected settlement', () => {
      expect(
        enqueueInterruptionsOnSettlement(
          db,
          { action: 'rejected', code: 'unknown_task', reason: 'gone' },
          { runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1' }
        )
      ).toBe(0)
    })
  })
})
