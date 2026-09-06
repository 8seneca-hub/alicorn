import { afterEach, describe, expect, it } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'

// Why these tests exist: `single` must stay genuinely the default (PROJECT-BRIEF §04). A task that
// nobody asked to orchestrate must read back as `single` *and* leave no row behind, so the escalation
// offer can still tell "never asked" from "asked for single".
describe('orchestration task execution strategy', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let ctx: RpcContext

  afterEach(() => {
    h.cleanup()
  })

  function setup(): void {
    ;({ db, ctx } = h.setup(true))
  }

  async function call(name: string, params: Record<string, unknown>) {
    return h.call(name, params, ctx)
  }

  type TaskResult = { task: { id: string; executionStrategy: string } }

  it('defaults to single and writes no row when the flag is absent', async () => {
    setup()
    const { task } = (await call('orchestration.taskCreate', { spec: 'x' })) as TaskResult

    expect(task.executionStrategy).toBe('single')
    expect(db.getTaskExecutionStrategy(task.id)).toMatchObject({
      strategy: 'single',
      source: 'default'
    })
    const row = db.db
      .prepare('SELECT count(*) AS n FROM alicorn_task_strategy WHERE task_id = ?')
      .get(task.id) as { n: number }
    expect(row.n).toBe(0)
  })

  it('records an orchestrated task as user-chosen', async () => {
    setup()
    const { task } = (await call('orchestration.taskCreate', {
      spec: 'big one',
      executionStrategy: 'orchestrated'
    })) as TaskResult

    expect(task.executionStrategy).toBe('orchestrated')
    expect(db.getTaskExecutionStrategy(task.id)).toMatchObject({
      strategy: 'orchestrated',
      source: 'user'
    })
  })

  it('flips a task back to single on update', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', {
      spec: 'big one',
      executionStrategy: 'orchestrated'
    })) as TaskResult

    const { task } = (await call('orchestration.taskUpdate', {
      id: created.task.id,
      status: 'ready',
      executionStrategy: 'single'
    })) as TaskResult

    expect(task.executionStrategy).toBe('single')
    expect(db.getTaskExecutionStrategy(created.task.id)).toMatchObject({
      strategy: 'single',
      source: 'user'
    })
  })

  it('leaves the strategy alone when an update omits the flag', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', {
      spec: 'big one',
      executionStrategy: 'orchestrated'
    })) as TaskResult

    const { task } = (await call('orchestration.taskUpdate', {
      id: created.task.id,
      status: 'completed'
    })) as TaskResult

    expect(task.executionStrategy).toBe('orchestrated')
  })

  // Why: an accepted escalation is the one case where `source` is not the user, and D4 must be able
  // to tell the two apart afterwards — an explicit user choice is not evidence the offer worked.
  it('does not overwrite an escalation source when the value is unchanged', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', { spec: 'x' })) as TaskResult
    db.setTaskExecutionStrategy(created.task.id, 'orchestrated', 'escalation')

    const { task } = (await call('orchestration.taskUpdate', {
      id: created.task.id,
      status: 'ready',
      executionStrategy: 'orchestrated'
    })) as TaskResult

    expect(task.executionStrategy).toBe('orchestrated')
    const strategy = db.getTaskExecutionStrategy(created.task.id)
    expect(strategy.source).toBe('escalation')
    expect(strategy.escalationAcceptedAt).not.toBeNull()
  })

  it('rejects an unknown strategy', async () => {
    setup()
    await expect(
      call('orchestration.taskCreate', { spec: 'x', executionStrategy: 'team' })
    ).rejects.toThrow()
  })

  it('reports the strategy on every task read', async () => {
    setup()
    const created = (await call('orchestration.taskCreate', {
      spec: 'big one',
      executionStrategy: 'orchestrated'
    })) as TaskResult
    await call('orchestration.taskCreate', { spec: 'small one' })

    const { tasks } = (await call('orchestration.taskList', {})) as {
      tasks: { id: string; executionStrategy: string }[]
    }
    const byId = new Map(tasks.map((t) => [t.id, t.executionStrategy]))
    expect(byId.get(created.task.id)).toBe('orchestrated')
    expect([...byId.values()].filter((s) => s === 'single')).toHaveLength(1)
  })
})
