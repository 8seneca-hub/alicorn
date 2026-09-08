import { afterEach, describe, expect, it } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'
import type { TaskWorktreeTuple } from '../../../../shared/alicorn/feature-workspace-tuples'

// A task binds no tuples until someone picks them, so every assertion here also has to hold for
// the single-workspace shape everything had before MR1.
describe('orchestration task worktree tuples', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let ctx: RpcContext
  let runId: string | undefined

  afterEach(() => {
    h.cleanup()
  })

  function setup(): void {
    ;({ db, ctx, activeRunId: runId } = h.setup(true))
  }

  // The harness only auto-scopes the method names it knows, so MR1's new ones name their run.
  async function call(name: string, params: Record<string, unknown>) {
    return h.call(name, { run: runId, callerTerminalHandle: 'term_coord', ...params }, ctx)
  }

  type TupleResult = { taskId: string; tuples: TaskWorktreeTuple[]; repoCount: number }

  async function createTask(): Promise<string> {
    const { task } = (await call('orchestration.taskCreate', { spec: 'x' })) as {
      task: { id: string }
    }
    return task.id
  }

  it('reads back an empty set for a task nobody bound', async () => {
    setup()
    const id = await createTask()
    const result = (await call('orchestration.taskWorktreesList', { id })) as TupleResult
    expect(result).toMatchObject({ taskId: id, tuples: [], repoCount: 0 })
  })

  it('stores a two-repo set and answers with the normalized order and primary', async () => {
    setup()
    const id = await createTask()
    const result = (await call('orchestration.taskWorktreesSet', {
      id,
      tuples: [
        { repoId: 'web', worktreeId: 'web::/w/web', branch: 'feat' },
        { repoId: 'api', worktreeId: 'api::/srv/api', branch: 'feat', primary: true }
      ]
    })) as TupleResult

    expect(result.repoCount).toBe(2)
    expect(result.tuples).toEqual([
      { repoId: 'api', worktreeId: 'api::/srv/api', branch: 'feat', primary: true },
      { repoId: 'web', worktreeId: 'web::/w/web', branch: 'feat', primary: false }
    ])
    expect(db.listTaskWorktrees(id)).toEqual(result.tuples)
  })

  it('accepts a JSON string, so the CLI flag path reaches the same store', async () => {
    setup()
    const id = await createTask()
    const result = (await call('orchestration.taskWorktreesSet', {
      id,
      tuples: JSON.stringify([{ repoId: 'folder-workspace:grp', worktreeId: 'folder:f1' }])
    })) as TupleResult
    expect(result.tuples).toEqual([
      { repoId: 'folder-workspace:grp', worktreeId: 'folder:f1', branch: null, primary: true }
    ])
  })

  it('refuses a task that is not in the caller’s run', async () => {
    setup()
    await expect(
      call('orchestration.taskWorktreesSet', { id: 'task-does-not-exist', tuples: [] })
    ).rejects.toThrow(/not found/i)
  })

  it('replaces the set rather than appending to it', async () => {
    setup()
    const id = await createTask()
    await call('orchestration.taskWorktreesSet', {
      id,
      tuples: [
        { repoId: 'web', worktreeId: 'web::/w/web' },
        { repoId: 'api', worktreeId: 'api::/srv/api' }
      ]
    })
    const result = (await call('orchestration.taskWorktreesSet', {
      id,
      tuples: [{ repoId: 'api', worktreeId: 'api::/srv/api' }]
    })) as TupleResult
    expect(result.tuples).toHaveLength(1)
    expect(result.repoCount).toBe(1)
  })
})
