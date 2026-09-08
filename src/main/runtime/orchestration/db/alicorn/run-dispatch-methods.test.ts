import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

describe('listRunDispatches', () => {
  let db: OrchestrationDb
  let seq = 0

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    seq = 0
  })

  afterEach(() => {
    db.close()
  })

  function run(objective: string): string {
    return db.createRun({
      objective,
      coordinatorHandle: `term_${objective}`,
      coordinatorPaneKey: `pane_${objective}`
    }).id
  }

  function dispatch(runId: string, worktreeId: string): string {
    const task = db.createTask({ spec: 'slice', runId })
    seq += 1
    const context = db.createDispatchContext({
      taskId: task.id,
      assigneeHandle: `term_worker_${seq}`,
      creator: { kind: 'system' },
      maxDepth: 3
    })
    db.db
      .prepare(
        `INSERT INTO worker_dispatches (dispatch_id, state, worktree_id, start_options)
         VALUES (?, 'succeeded', ?, '{"agent":"codex"}')`
      )
      .run(context.id, worktreeId)
    return context.id
  }

  it('returns every dispatch of the run, across all of its tasks', () => {
    const runId = run('alpha')
    const first = dispatch(runId, 'wt-a')
    const second = dispatch(runId, 'wt-b')
    dispatch(run('beta'), 'wt-c')

    const rows = db.listRunDispatches(runId)

    expect(rows.map((row) => row.dispatchId).sort()).toEqual([first, second].sort())
    expect(rows.every((row) => row.startOptions === '{"agent":"codex"}')).toBe(true)
    expect(new Set(rows.map((row) => row.taskId)).size).toBe(2)
  })

  it('carries the member backend when one is assigned, and null when not', () => {
    const runId = run('alpha')
    const assigned = dispatch(runId, 'wt-a')
    const unassigned = dispatch(runId, 'wt-b')
    db.setDispatchMember({
      dispatchId: assigned,
      memberId: 'member-1',
      memberRole: 'developer',
      backend: 'claude',
      reviewBackendBypass: false
    })

    const byId = new Map(db.listRunDispatches(runId).map((row) => [row.dispatchId, row]))
    expect(byId.get(assigned)?.memberBackend).toBe('claude')
    expect(byId.get(unassigned)?.memberBackend).toBeNull()
  })

  it('returns nothing for a run that has dispatched nothing', () => {
    const runId = run('alpha')
    db.createTask({ spec: 'never dispatched', runId })
    expect(db.listRunDispatches(runId)).toEqual([])
  })
})
