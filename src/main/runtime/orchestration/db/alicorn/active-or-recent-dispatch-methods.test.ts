import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('listActiveOrRecentlyCompletedDispatches', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  function startDispatchedWorker(startOptions: unknown): { taskId: string; dispatchId: string } {
    const task = db.createTask({ spec: 'work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions,
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.markWorkerDispatchReady(dispatch.id)
    db.recordWorkerStage({
      dispatchId: dispatch.id,
      stage: 'input_accepted',
      worktreeId: 'wt_1'
    })
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  it('returns a dispatched worker with its worktree and raw start_options', () => {
    const { dispatchId } = startDispatchedWorker({ agent: 'claude' })

    const rows = db.listActiveOrRecentlyCompletedDispatches('2000-01-01 00:00:00')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      dispatchId,
      worktreeId: 'wt_1',
      startOptions: JSON.stringify({ agent: 'claude' }),
      memberBackend: null
    })
    expect(rows[0].dispatchedAt).toEqual(expect.any(String))
  })

  it('prefers the alicorn_dispatch_members backend over start_options', () => {
    const { dispatchId } = startDispatchedWorker({ agent: 'claude' })
    db.setDispatchMember({
      dispatchId,
      memberId: 'member_1',
      memberRole: 'implementer',
      backend: 'codex',
      reviewBackendBypass: false
    })

    const rows = db.listActiveOrRecentlyCompletedDispatches('2000-01-01 00:00:00')

    expect(rows[0].memberBackend).toBe('codex')
  })

  it('excludes a pending (not-yet-ready) dispatch', () => {
    const task = db.createTask({ spec: 'work' })
    db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })

    const rows = db.listActiveOrRecentlyCompletedDispatches('2000-01-01 00:00:00')

    expect(rows).toHaveLength(0)
  })

  it('excludes a completed dispatch older than the window', () => {
    const { dispatchId } = startDispatchedWorker({ agent: 'claude' })
    db.db
      .prepare("UPDATE dispatch_contexts SET status = 'completed', completed_at = ? WHERE id = ?")
      .run('2000-01-01 00:00:00', dispatchId)

    const rows = db.listActiveOrRecentlyCompletedDispatches('2020-01-01 00:00:00')

    expect(rows).toHaveLength(0)
  })

  it('includes a completed dispatch within the window', () => {
    const { dispatchId } = startDispatchedWorker({ agent: 'claude' })
    db.db
      .prepare("UPDATE dispatch_contexts SET status = 'completed', completed_at = ? WHERE id = ?")
      .run('2025-01-01 00:00:00', dispatchId)

    const rows = db.listActiveOrRecentlyCompletedDispatches('2020-01-01 00:00:00')

    expect(rows).toHaveLength(1)
    expect(rows[0].dispatchId).toBe(dispatchId)
  })
})
