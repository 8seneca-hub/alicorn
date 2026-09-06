import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import type { EscalationOffer } from '../../shared/alicorn/context-ceiling'
import { startContextCeilingWatcher } from './context-ceiling-watcher'

const NOW = Date.parse('2026-09-06T10:00:00.000Z')

function overCeilingTranscript(): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 'sess_1',
    timestamp: '2026-09-06T09:59:00.000Z',
    message: {
      id: 'm1',
      model: 'claude-opus-5',
      usage: { input_tokens: 250_000, cache_read_input_tokens: 61_000 }
    }
  })
}

describe('context ceiling watcher', () => {
  let db: OrchestrationDb
  let published: EscalationOffer[]

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    published = []
  })

  afterEach(() => {
    db.close()
  })

  function seedDispatchedWorker(agent = 'claude'): { taskId: string; dispatchId: string } {
    const task = db.createTask({ spec: 'do the thing' })
    const dispatchId = 'ctx_1'
    db.db
      .prepare(
        `INSERT INTO dispatch_contexts (id, run_id, task_id, status) VALUES (?, 'run_1', ?, 'dispatched')`
      )
      .run(dispatchId, task.id)
    db.db
      .prepare(
        `INSERT INTO worker_dispatches (dispatch_id, worktree_id, start_options) VALUES (?, 'wt1', ?)`
      )
      .run(dispatchId, JSON.stringify({ agent }))
    return { taskId: task.id, dispatchId }
  }

  function watcher(overrides: Record<string, unknown> = {}) {
    return startContextCeilingWatcher({
      getDb: () => db,
      claudeUsage: {
        getRecentSessionTranscriptsForWorktree: () => [
          {
            sessionId: 'sess_1',
            path: '/t/sess_1.jsonl',
            lastTimestamp: '2026-09-06T09:59:00.000Z'
          }
        ]
      },
      readTail: async () => overCeilingTranscript(),
      publish: (offer) => published.push(offer),
      now: () => NOW,
      intervalMs: 0,
      ...overrides
    })
  }

  it('offers once when a single-agent claude task crosses the ceiling', async () => {
    const { taskId, dispatchId } = seedDispatchedWorker()
    const w = watcher()

    const offers = await w.tickOnce()
    w.stop()

    expect(offers).toEqual([{ taskId, dispatchId, paneKey: null, contextTokens: 311_000 }])
    expect(published).toHaveLength(1)
    expect(db.getTaskExecutionStrategy(taskId).escalationOfferedAt).not.toBeNull()
  })

  // Why: the offer is a one-shot. `markEscalationOffered` is the guard, so a second tick on a task
  // still over the ceiling must stay silent rather than nag every interval.
  it('does not offer twice for the same task', async () => {
    seedDispatchedWorker()
    const w = watcher()

    await w.tickOnce()
    const second = await w.tickOnce()
    w.stop()

    expect(second).toEqual([])
    expect(published).toHaveLength(1)
  })

  it('skips a task already running orchestrated', async () => {
    const { taskId } = seedDispatchedWorker()
    db.setTaskExecutionStrategy(taskId, 'orchestrated', 'user')
    const w = watcher()

    expect(await w.tickOnce()).toEqual([])
    w.stop()
  })

  it('stays silent below the ceiling', async () => {
    seedDispatchedWorker()
    const w = watcher({
      readTail: async () =>
        JSON.stringify({
          type: 'assistant',
          sessionId: 'sess_1',
          timestamp: '2026-09-06T09:59:00.000Z',
          message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 1_000 } }
        })
    })

    expect(await w.tickOnce()).toEqual([])
    w.stop()
  })

  // Why: tier 1 detects the ceiling for Claude Code only; another backend must not be offered an
  // escalation we cannot substantiate.
  it('ignores a non-claude backend', async () => {
    seedDispatchedWorker('codex')
    const w = watcher()

    expect(await w.tickOnce()).toEqual([])
    w.stop()
  })

  it('ignores a dispatch that is no longer running', async () => {
    const { dispatchId } = seedDispatchedWorker()
    db.db.prepare(`UPDATE dispatch_contexts SET status = 'completed' WHERE id = ?`).run(dispatchId)
    const w = watcher()

    expect(await w.tickOnce()).toEqual([])
    w.stop()
  })

  it('does nothing without a usage store', async () => {
    seedDispatchedWorker()
    const w = watcher({ claudeUsage: null })

    expect(await w.tickOnce()).toEqual([])
    w.stop()
  })

  // Why: a watcher that throws on one unreadable transcript would stop measuring every other task.
  it('survives an unreadable transcript', async () => {
    seedDispatchedWorker()
    const w = watcher({
      readTail: async () => {
        throw new Error('EACCES')
      }
    })

    await expect(w.tickOnce()).resolves.toEqual([])
    w.stop()
  })

  it('stops ticking after stop()', async () => {
    seedDispatchedWorker()
    const tick = vi.fn()
    const w = startContextCeilingWatcher({
      getDb: () => db,
      claudeUsage: null,
      publish: tick,
      now: () => NOW,
      intervalMs: 1
    })
    w.stop()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(tick).not.toHaveBeenCalled()
  })
})
