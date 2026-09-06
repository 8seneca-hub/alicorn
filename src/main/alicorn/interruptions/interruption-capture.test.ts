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

  it('attributes 2 gates raised between dispatches, 1 ask and 1 escalation offer to the next settling dispatch', () => {
    // LC-R9: createGate ends the dispatch that raises it, so both gates below land between
    // dispatch1's completion and dispatch2's — via the real write path (createGate/resolveGate),
    // not a raw insert, per controller ruling.
    const task = db.createTask({ spec: 'work' })
    const dispatch1 = createRootDispatch(db, task.id, 'term_worker_1')
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch1.id,
      outcome: 'succeeded',
      result: 'phase 1 done'
    })

    const gate1 = db.createGate({ taskId: task.id, question: 'approach A or B?' })
    const gate2 = db.createGate({ taskId: task.id, question: 'ship now or wait?' })
    db.resolveGate(gate1.id, 'A') // any gate's resolution returns the task to 'ready'

    const dispatch2 = createRootDispatch(db, task.id, 'term_worker_2')
    const { question } = db.createQuestion({
      runId: task.run_id,
      dispatchId: dispatch2.id,
      askerHandle: 'term_worker_2',
      question: 'which approach?'
    })
    db.markEscalationOffered(task.id)
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch2.id,
      outcome: 'succeeded',
      result: 'done'
    })

    const ids = { runId: task.run_id, taskId: task.id, dispatchId: dispatch2.id }
    const count = enqueueInterruptionsForDispatch(db, ids)

    expect(count).toBe(4)
    const rows = interruptionRows()
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.kind).sort()).toEqual(['ask', 'escalation', 'gate', 'gate'])
    // Every row is attributed to dispatch2 — the dispatch that settled, not the one that raised it.
    expect(
      rows.every((r) => (r.payload as { dispatchId: string }).dispatchId === dispatch2.id)
    ).toBe(true)

    const gateSourceIds = rows.filter((r) => r.kind === 'gate').map((r) => r.sourceId)
    expect(gateSourceIds.sort()).toEqual([gate1.id, gate2.id].sort())
    const gateRow = rows.find((r) => r.sourceId === gate1.id)!
    expect(gateRow.dedupeKey).toBe(`interruption:gate:${gate1.id}`)
    expect(gateRow.payload).toMatchObject({
      runId: task.run_id,
      taskId: task.id,
      dispatchId: dispatch2.id,
      resolvedBy: null
    })
    expect(() =>
      new Date((gateRow.payload as { occurredAt: string }).occurredAt).toISOString()
    ).not.toThrow()

    const ask = rows.find((r) => r.kind === 'ask')!
    expect(ask.sourceId).toBe(question.message_id)
    expect(ask.dedupeKey).toBe(`interruption:ask:${question.message_id}`)

    const escalation = rows.find((r) => r.kind === 'escalation')!
    expect(escalation.sourceId).toBe(task.id)
    expect(escalation.dedupeKey).toBe(`interruption:escalation:${task.id}`)
  })

  it('counts an ask raised under an earlier, already-settled dispatch of the same task', () => {
    // Raw insert, justified: naturally, an ask is captured by its own dispatch's settlement
    // (dispatch_id fast path), so reaching the join-based window match needs a question_threads
    // row whose dispatch_id predates the settling dispatch but whose timestamp still lands in
    // the window — not reproducible through createQuestion without manual clock control, since
    // createQuestion always stamps "now" and requires the dispatch to still be active.
    const task = db.createTask({ spec: 'work' })
    const dispatch1 = createRootDispatch(db, task.id, 'term_worker_1')
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch1.id,
      outcome: 'succeeded',
      result: 'phase 1 done'
    })
    const gate = db.createGate({ taskId: task.id, question: 'continue?' })
    db.resolveGate(gate.id, 'yes')
    const dispatch2 = createRootDispatch(db, task.id, 'term_worker_2')
    db.db
      .prepare(
        `INSERT INTO question_threads (message_id, run_id, dispatch_id, asker_handle, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run('msg_late_ask', task.run_id, dispatch1.id, 'term_worker_1', gate.created_at)
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch2.id,
      outcome: 'succeeded',
      result: 'done'
    })

    const count = enqueueInterruptionsForDispatch(db, {
      runId: task.run_id,
      taskId: task.id,
      dispatchId: dispatch2.id
    })

    expect(count).toBe(2) // the gate plus the cross-dispatch ask
    const ask = interruptionRows().find((r) => r.kind === 'ask')!
    expect(ask.sourceId).toBe('msg_late_ask')
  })

  it('dedupes an escalation offer landing exactly on the boundary shared by two consecutive windows', () => {
    // Both captures run in the same order the real hook would fire them (once per settlement,
    // as it happens) — no retroactive/out-of-order calls. dispatch1's own capture sees the offer
    // as its upper bound; dispatch2's capture, run later, sees the very same offer as its lower
    // bound because it's pinned to exactly dispatch1's completed_at. sourceId must be the task,
    // not either dispatch, so both attempts share one dedupe key.
    const task = db.createTask({ spec: 'work' })
    const dispatch1 = createRootDispatch(db, task.id, 'term_worker_1')
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch1.id,
      outcome: 'succeeded',
      result: 'phase 1 done'
    })
    db.markEscalationOffered(task.id)
    // Pin the offer to exactly dispatch1's completed_at, the shared boundary second. Re-read
    // the row: the local `dispatch1` binding is a stale pre-settlement snapshot with no completed_at.
    const settledDispatch1 = db.getDispatchContextById(dispatch1.id)!
    db.db
      .prepare(`UPDATE alicorn_task_strategy SET escalation_offered_at = ? WHERE task_id = ?`)
      .run(settledDispatch1.completed_at, task.id)
    enqueueInterruptionsForDispatch(db, {
      runId: task.run_id,
      taskId: task.id,
      dispatchId: dispatch1.id
    })

    const gate = db.createGate({ taskId: task.id, question: 'continue?' })
    db.resolveGate(gate.id, 'yes')
    const dispatch2 = createRootDispatch(db, task.id, 'term_worker_2')
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch2.id,
      outcome: 'succeeded',
      result: 'done'
    })
    enqueueInterruptionsForDispatch(db, {
      runId: task.run_id,
      taskId: task.id,
      dispatchId: dispatch2.id
    })

    const escalationRows = interruptionRows().filter((r) => r.kind === 'escalation')
    expect(escalationRows).toHaveLength(1)
    expect(escalationRows[0].sourceId).toBe(task.id)
  })

  it('re-running over the same dispatch enqueues no new rows', () => {
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    // Raw insert: this test is about outbox dedupe, not gate provenance.
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

  it('does not count a gate created outside the window', () => {
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    // Well before the window start (this is the task's first dispatch, so the window opens at
    // the task's created_at, which is "now"). Raw insert: needs a deterministic past timestamp,
    // not reachable via createGate's datetime('now') stamping.
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
