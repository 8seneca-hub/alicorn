import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('dispatch verification methods', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  function record(overrides: Record<string, unknown> = {}): void {
    db.recordDispatchVerification({
      dispatchId: 'dispatch-1',
      taskId: 'task-1',
      kind: 'diff_coverage',
      name: 'Diff coverage ≥ 80%',
      required: true,
      status: 'passed',
      ...overrides
    } as Parameters<OrchestrationDb['recordDispatchVerification']>[0])
  }

  it('stores a result and reads it back for the task', () => {
    record({ detail: { covered: 0.91 } })
    const rows = db.listTaskVerifications('task-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      dispatchId: 'dispatch-1',
      kind: 'diff_coverage',
      required: true,
      status: 'passed',
      detail: '{"covered":0.91}'
    })
  })

  it('replaces a result for the same dispatch, kind and name', () => {
    record({ status: 'failed' })
    record({ status: 'passed' })
    const rows = db.listTaskVerifications('task-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('passed')
  })

  it('keeps results from different dispatches of the same task apart', () => {
    record()
    record({ dispatchId: 'dispatch-2', status: 'failed' })
    expect(db.listTaskVerifications('task-1')).toHaveLength(2)
  })

  it('returns nothing for a task with no recorded checks', () => {
    expect(db.listTaskVerifications('task-unknown')).toEqual([])
  })

  it('refuses a status outside the vocabulary', () => {
    expect(() => record({ status: 'probably' })).toThrow()
  })
})
