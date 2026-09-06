import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { detectReopenedTasks } from './reopened-task-detector'

describe('detectReopenedTasks', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  function dispatchAndSettle(taskId: string, outcome: 'succeeded' | 'failed'): string {
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.markWorkerDispatchReady(dispatch.id)
    db.settleWorkerReport({
      taskId,
      dispatchId: dispatch.id,
      outcome,
      result: JSON.stringify({ filesModified: [] })
    })
    return dispatch.id
  }

  function redispatch(taskId: string): void {
    db.createStartingWorkerDispatch({
      taskId,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
  }

  it('reports a reopened task whose prior dispatch succeeded', () => {
    const task = db.createTask({ spec: 'work' })
    const priorDispatchId = dispatchAndSettle(task.id, 'succeeded')
    db.updateTaskStatus(task.id, 'ready')
    redispatch(task.id)

    const result = detectReopenedTasks(db, '2000-01-01 00:00:00')

    expect(result).toHaveLength(1)
    expect(result[0].priorDispatchId).toBe(priorDispatchId)
    expect(result[0].newDispatchedAt).toEqual(expect.any(String))
    expect(result[0].priorCompletedAt).toEqual(expect.any(String))
  })

  it('does not report when the prior dispatch failed', () => {
    const task = db.createTask({ spec: 'work' })
    dispatchAndSettle(task.id, 'failed')
    db.updateTaskStatus(task.id, 'ready')
    redispatch(task.id)

    expect(detectReopenedTasks(db, '2000-01-01 00:00:00')).toEqual([])
  })

  it('does not report a task with only one (settled) dispatch', () => {
    const task = db.createTask({ spec: 'work' })
    dispatchAndSettle(task.id, 'succeeded')

    expect(detectReopenedTasks(db, '2000-01-01 00:00:00')).toEqual([])
  })

  it('excludes a reopening whose new dispatch is before the cutoff', () => {
    const task = db.createTask({ spec: 'work' })
    dispatchAndSettle(task.id, 'succeeded')
    db.updateTaskStatus(task.id, 'ready')
    redispatch(task.id)

    expect(detectReopenedTasks(db, '2999-01-01 00:00:00')).toEqual([])
  })
})
