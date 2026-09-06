import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('listSettledDispatchesForCorrections', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  function settleWithWorktree(outcome: 'succeeded' | 'failed'): {
    taskId: string
    dispatchId: string
  } {
    const task = db.createTask({ spec: 'work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.markWorkerDispatchReady(dispatch.id)
    db.recordWorkerStage({
      dispatchId: dispatch.id,
      stage: 'input_accepted',
      worktreeId: 'wt_1'
    })
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome,
      result: JSON.stringify({ phase: 'build', body: 'done', filesModified: [] })
    })
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  it('returns a settled dispatch with its worktree', () => {
    const { taskId, dispatchId } = settleWithWorktree('succeeded')

    const rows = db.listSettledDispatchesForCorrections('2000-01-01 00:00:00')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ dispatchId, taskId, worktreeId: 'wt_1' })
    expect(rows[0].completedAt).toEqual(expect.any(String))
  })

  it('includes a failed dispatch too', () => {
    const { dispatchId } = settleWithWorktree('failed')

    const rows = db.listSettledDispatchesForCorrections('2000-01-01 00:00:00')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ dispatchId })
  })

  it('excludes a dispatch that completed before the cutoff', () => {
    settleWithWorktree('succeeded')

    const rows = db.listSettledDispatchesForCorrections('2999-01-01 00:00:00')

    expect(rows).toHaveLength(0)
  })
})
