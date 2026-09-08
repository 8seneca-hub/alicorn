import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { createRunBlastRadiusSource, type RunBlastRadiusDeps } from './run-blast-radius'

describe('createRunBlastRadiusSource', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runIds.clear()
    dispatchSeq = 0
  })

  afterEach(() => {
    db.close()
  })

  const runIds = new Map<string, string>()
  let dispatchSeq = 0

  /** A run keyed by a stable test label, created on first use. */
  function run(label: string): string {
    const existing = runIds.get(label)
    if (existing) {
      return existing
    }
    const created = db.createRun({
      objective: label,
      coordinatorHandle: `term_${label}`,
      coordinatorPaneKey: `pane_${label}`
    })
    runIds.set(label, created.id)
    return created.id
  }

  /** One task with one settled worker dispatch, in the given run and worktree. */
  function dispatchInRun(label: string, worktreeId: string | null): string {
    const runId = run(label)
    const task = db.createTask({ spec: 'a slice', runId })
    dispatchSeq += 1
    const dispatch = db.createDispatchContext({
      taskId: task.id,
      assigneeHandle: `term_worker_${dispatchSeq}`,
      creator: { kind: 'system' },
      maxDepth: 3
    })
    db.db
      .prepare(
        `INSERT INTO worker_dispatches (dispatch_id, state, worktree_id, start_options)
         VALUES (?, 'succeeded', ?, '{"agent":"claude"}')`
      )
      .run(dispatch.id, worktreeId)
    return dispatch.id
  }

  function source(overrides: Partial<RunBlastRadiusDeps> = {}) {
    return createRunBlastRadiusSource({
      getDb: () => db,
      readChangedFiles: vi.fn().mockResolvedValue([]),
      readDispatchSpendCents: vi.fn().mockResolvedValue(0),
      ...overrides
    })
  }

  it('sums spend across every task in the run, so five small tasks cannot launder past a budget', async () => {
    // The laundering case, stated exactly: no single task spends 100c, the run spends 250c.
    for (let index = 0; index < 5; index += 1) {
      dispatchInRun('run-1', `worktree-${index}`)
    }
    const measured = await source({
      readDispatchSpendCents: vi.fn().mockResolvedValue(50)
    }).measure(run('run-1'))

    expect(measured.spendCents).toBe(250)
  })

  it('unions files across every task in the run, and counts a shared worktree once', async () => {
    // Three tasks, two worktrees. A per-task count would report 2; the run's reach is 4.
    dispatchInRun('run-1', 'worktree-a')
    dispatchInRun('run-1', 'worktree-a')
    dispatchInRun('run-1', 'worktree-b')
    const readChangedFiles = vi.fn(async (worktreeId: string) =>
      worktreeId === 'worktree-a' ? ['src/a.ts', 'src/b.ts'] : ['src/c.ts', 'src/d.ts']
    )

    const measured = await source({ readChangedFiles }).measure(run('run-1'))

    expect(measured.filesChanged).toBe(4)
    expect(measured.changedPaths?.sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'])
    // Read once per worktree, not once per dispatch.
    expect(readChangedFiles).toHaveBeenCalledTimes(2)
  })

  it('counts the same relative path in two repositories as two files', async () => {
    dispatchInRun('run-1', 'worktree-a')
    dispatchInRun('run-1', 'worktree-b')

    const measured = await source({
      readChangedFiles: vi.fn().mockResolvedValue(['src/index.ts'])
    }).measure(run('run-1'))

    expect(measured.filesChanged).toBe(2)
    expect(measured.changedPaths).toEqual(['src/index.ts'])
  })

  it('leaves another run out of the accumulation', async () => {
    dispatchInRun('run-1', 'worktree-a')
    dispatchInRun('run-2', 'worktree-b')

    const measured = await source({
      readChangedFiles: vi.fn(async (worktreeId: string) => [`${worktreeId}/file.ts`]),
      readDispatchSpendCents: vi.fn().mockResolvedValue(11)
    }).measure(run('run-1'))

    expect(measured).toMatchObject({ filesChanged: 1, spendCents: 11 })
    expect(measured.changedPaths).toEqual(['worktree-a/file.ts'])
  })

  it('reports a measured zero for a run that has dispatched nothing', async () => {
    db.createTask({ spec: 'never dispatched', runId: run('run-1') })

    await expect(source().measure(run('run-1'))).resolves.toEqual({
      filesChanged: 0,
      spendCents: 0,
      changedPaths: []
    })
  })

  it('reports unknown files when one worktree of the run cannot be read', async () => {
    dispatchInRun('run-1', 'worktree-a')
    dispatchInRun('run-1', 'worktree-unreachable')

    const measured = await source({
      readChangedFiles: vi.fn(async (worktreeId: string) =>
        worktreeId === 'worktree-a' ? ['src/a.ts'] : null
      )
    }).measure(run('run-1'))

    // Partly unknown is unknown: a floor must never be compared against a ceiling.
    expect(measured.filesChanged).toBeNull()
    expect(measured.changedPaths).toBeNull()
    expect(measured.spendCents).toBe(0)
  })

  it('reports unknown files when a dispatch of the run has no worktree', async () => {
    dispatchInRun('run-1', 'worktree-a')
    dispatchInRun('run-1', null)

    const measured = await source({
      readChangedFiles: vi.fn().mockResolvedValue(['src/a.ts'])
    }).measure(run('run-1'))

    expect(measured.filesChanged).toBeNull()
  })

  it('reports unknown spend when one dispatch of the run is unpriced', async () => {
    const priced = dispatchInRun('run-1', 'worktree-a')
    dispatchInRun('run-1', 'worktree-b')

    const measured = await source({
      readDispatchSpendCents: vi.fn(async (row) => (row.dispatchId === priced ? 90 : null))
    }).measure(run('run-1'))

    expect(measured.spendCents).toBeNull()
    expect(measured.filesChanged).toBe(0)
  })

  it('treats a throwing reader as unknown rather than as clean', async () => {
    dispatchInRun('run-1', 'worktree-a')

    const measured = await source({
      readChangedFiles: vi.fn().mockRejectedValue(new Error('git is gone')),
      readDispatchSpendCents: vi.fn().mockRejectedValue(new Error('no usage store'))
    }).measure(run('run-1'))

    expect(measured).toEqual({ filesChanged: null, spendCents: null, changedPaths: null })
  })

  it('reports everything unknown when there is no orchestration database', async () => {
    await expect(source({ getDb: () => null }).measure('run-1')).resolves.toEqual({
      filesChanged: null,
      spendCents: null,
      changedPaths: null
    })
  })
})
