import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'
import { createRootDispatch } from '../root-dispatch-test-fixture'

describe('worker report settlement enqueues the ledger outbox', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  function dispatchedTask(spec: string): { taskId: string; dispatchId: string } {
    const task = db.createTask({ spec })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  it('enqueues exactly one step_outcome row on a settled report', () => {
    const { taskId, dispatchId } = dispatchedTask('ship the feature')

    const settlement = db.settleWorkerReport({
      taskId,
      dispatchId,
      outcome: 'succeeded',
      result: 'done the work'
    })

    expect(settlement).toEqual({ action: 'settled', outcome: 'succeeded', duplicate: false })
    const due = db.listDueLedgerOutbox()
    expect(due).toHaveLength(1)
    expect(due[0].kind).toBe('step_outcome')
    expect(due[0].dedupe_key).toBe(`step_outcome:${dispatchId}`)
    expect(JSON.parse(due[0].payload)).toEqual({
      taskId,
      dispatchId,
      outcome: 'succeeded',
      result: 'done the work'
    })
  })

  it('adds no row when the same settlement is reported again', () => {
    const { taskId, dispatchId } = dispatchedTask('idempotent report')

    db.settleWorkerReport({ taskId, dispatchId, outcome: 'succeeded', result: 'done' })
    const repeat = db.settleWorkerReport({
      taskId,
      dispatchId,
      outcome: 'succeeded',
      result: 'done'
    })

    expect(repeat).toEqual({ action: 'settled', outcome: 'succeeded', duplicate: true })
    expect(db.listDueLedgerOutbox()).toHaveLength(1)
  })

  it('adds no row when the settlement is rejected', () => {
    const settlement = db.settleWorkerReport({
      taskId: 'task_missing',
      dispatchId: 'ctx_missing',
      outcome: 'succeeded',
      result: 'done'
    })

    expect(settlement).toMatchObject({ action: 'rejected', code: 'unknown_task' })
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
  })
})
