import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { startRunCostPublisher, type RunCostPublisher } from './run-cost-publisher'
import type { AutomationRunUsage } from '../../shared/automations-types'

const NOW_MS = Date.UTC(2026, 8, 6, 12, 0, 0)
const LAST_SCAN_MS = Date.UTC(2026, 8, 6, 11, 55, 0)

function knownUsage(estimatedCostUsd: number | null): AutomationRunUsage {
  return {
    status: 'known',
    provider: 'claude',
    model: 'claude-opus-4',
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningOutputTokens: null,
    totalTokens: 300,
    estimatedCostUsd,
    estimatedCostSource: 'api_equivalent',
    providerSessionId: 'sess_1',
    attribution: 'provider_session_time_window',
    collectedAt: NOW_MS,
    unavailableReason: null,
    unavailableMessage: null
  }
}

describe('startRunCostPublisher', () => {
  let db: OrchestrationDb
  let publisher: RunCostPublisher | undefined

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    publisher?.stop()
    db.close()
  })

  function startDispatchedWorker(
    startOptions: unknown,
    worktreeId: string | null = 'wt_1'
  ): string {
    const task = db.createTask({ spec: 'work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions,
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.markWorkerDispatchReady(dispatch.id)
    if (worktreeId) {
      db.recordWorkerStage({
        dispatchId: dispatch.id,
        stage: 'input_accepted',
        worktreeId
      })
    }
    return dispatch.id
  }

  it('publishes a known cost for a Claude dispatch, calling the store with completedAt = lastScanCompletedAt', async () => {
    const dispatchId = startDispatchedWorker({ agent: 'claude' })
    const getAutomationRunUsage = vi.fn().mockResolvedValue(knownUsage(0.82))
    const publish = vi.fn()
    publisher = startRunCostPublisher({
      getDb: () => db,
      claudeUsage: {
        getAutomationRunUsage,
        getLastScanCompletedAt: () => LAST_SCAN_MS
      },
      codexUsage: null,
      publish,
      intervalMs: 0,
      now: () => NOW_MS
    })

    const payload = await publisher.tickOnce()

    expect(payload).toEqual({ [dispatchId]: { costUsd: 0.82, status: 'known' } })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(payload)
    expect(getAutomationRunUsage).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt_1', completedAt: LAST_SCAN_MS })
    )
  })

  it('publishes nothing on a second tick when the payload is unchanged', async () => {
    startDispatchedWorker({ agent: 'claude' })
    const getAutomationRunUsage = vi.fn().mockResolvedValue(knownUsage(0.82))
    const publish = vi.fn()
    publisher = startRunCostPublisher({
      getDb: () => db,
      claudeUsage: { getAutomationRunUsage, getLastScanCompletedAt: () => LAST_SCAN_MS },
      codexUsage: null,
      publish,
      intervalMs: 0,
      now: () => NOW_MS
    })

    await publisher.tickOnce()
    await publisher.tickOnce()

    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('reports unavailable for a backend Alicorn does not price, without touching any store', async () => {
    const dispatchId = startDispatchedWorker({ agent: 'grok' })
    const claudeGetAutomationRunUsage = vi.fn()
    const publish = vi.fn()
    publisher = startRunCostPublisher({
      getDb: () => db,
      claudeUsage: {
        getAutomationRunUsage: claudeGetAutomationRunUsage,
        getLastScanCompletedAt: () => LAST_SCAN_MS
      },
      codexUsage: null,
      publish,
      intervalMs: 0,
      now: () => NOW_MS
    })

    const payload = await publisher.tickOnce()

    expect(payload).toEqual({ [dispatchId]: { costUsd: null, status: 'unavailable' } })
    expect(claudeGetAutomationRunUsage).not.toHaveBeenCalled()
  })

  it('reports pending for a dispatch that has no worktree yet, without touching any store', async () => {
    const dispatchId = startDispatchedWorker({ agent: 'claude' }, null)
    const getAutomationRunUsage = vi.fn()
    const publish = vi.fn()
    publisher = startRunCostPublisher({
      getDb: () => db,
      claudeUsage: { getAutomationRunUsage, getLastScanCompletedAt: () => LAST_SCAN_MS },
      codexUsage: null,
      publish,
      intervalMs: 0,
      now: () => NOW_MS
    })

    const payload = await publisher.tickOnce()

    expect(payload).toEqual({ [dispatchId]: { costUsd: null, status: 'pending' } })
    expect(getAutomationRunUsage).not.toHaveBeenCalled()
  })

  it('bounds completedAt to the dispatch’s own completion time, not to now, once the scan has caught up', async () => {
    const dispatchId = startDispatchedWorker({ agent: 'claude' })
    // 20h before NOW_MS, well inside the publisher's 24h recent window.
    db.db
      .prepare(`UPDATE dispatch_contexts SET status = 'completed', completed_at = ? WHERE id = ?`)
      .run('2026-09-05 16:00:00', dispatchId)
    const getAutomationRunUsage = vi.fn().mockResolvedValue(knownUsage(0.1))
    publisher = startRunCostPublisher({
      getDb: () => db,
      // lastScanCompletedAt is now — well past the dispatch's own completion —
      // so the bound must be the dispatch's completedAt, not the scan's.
      claudeUsage: { getAutomationRunUsage, getLastScanCompletedAt: () => NOW_MS },
      codexUsage: null,
      publish: vi.fn(),
      intervalMs: 0,
      now: () => NOW_MS
    })

    await publisher.tickOnce()

    expect(getAutomationRunUsage).toHaveBeenCalledWith(
      expect.objectContaining({ completedAt: Date.UTC(2026, 8, 5, 16, 0, 0) })
    )
  })

  it('uses now() as completedAt when the store has never completed a scan', async () => {
    const dispatchId = startDispatchedWorker({ agent: 'claude' })
    const getAutomationRunUsage = vi.fn().mockResolvedValue(knownUsage(0.5))
    publisher = startRunCostPublisher({
      getDb: () => db,
      claudeUsage: { getAutomationRunUsage, getLastScanCompletedAt: () => null },
      codexUsage: null,
      publish: vi.fn(),
      intervalMs: 0,
      now: () => NOW_MS
    })

    await publisher.tickOnce()

    expect(getAutomationRunUsage).toHaveBeenCalledWith(
      expect.objectContaining({ completedAt: NOW_MS })
    )
    void dispatchId
  })

  it('passes through a known usage with no cost figure as known + null, not unavailable', async () => {
    const dispatchId = startDispatchedWorker({ agent: 'claude' })
    const getAutomationRunUsage = vi.fn().mockResolvedValue(knownUsage(null))
    publisher = startRunCostPublisher({
      getDb: () => db,
      claudeUsage: { getAutomationRunUsage, getLastScanCompletedAt: () => LAST_SCAN_MS },
      codexUsage: null,
      publish: vi.fn(),
      intervalMs: 0,
      now: () => NOW_MS
    })

    const payload = await publisher.tickOnce()

    expect(payload).toEqual({ [dispatchId]: { costUsd: null, status: 'known' } })
  })

  it('isolates a throwing dispatch: the good one stays known, the bad one becomes unavailable, and the tick still resolves', async () => {
    const goodId = startDispatchedWorker({ agent: 'claude' }, 'wt_good')
    const badId = startDispatchedWorker({ agent: 'claude' }, 'wt_bad')
    const getAutomationRunUsage = vi
      .fn()
      .mockImplementation(async (input: { worktreeId: string }) => {
        if (input.worktreeId === 'wt_bad') {
          throw new Error('boom')
        }
        return knownUsage(0.5)
      })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    publisher = startRunCostPublisher({
      getDb: () => db,
      claudeUsage: { getAutomationRunUsage, getLastScanCompletedAt: () => LAST_SCAN_MS },
      codexUsage: null,
      publish: vi.fn(),
      intervalMs: 0,
      now: () => NOW_MS
    })

    const payload = await publisher.tickOnce()

    expect(payload).toEqual({
      [goodId]: { costUsd: 0.5, status: 'known' },
      [badId]: { costUsd: null, status: 'unavailable' }
    })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('does not start a second tick while the previous one is still in flight', () => {
    startDispatchedWorker({ agent: 'claude' })
    let resolveUsage: ((usage: AutomationRunUsage) => void) | undefined
    const getAutomationRunUsage = vi.fn(
      () =>
        new Promise<AutomationRunUsage>((resolve) => {
          resolveUsage = resolve
        })
    )
    vi.useFakeTimers()
    publisher = startRunCostPublisher({
      getDb: () => db,
      claudeUsage: { getAutomationRunUsage, getLastScanCompletedAt: () => LAST_SCAN_MS },
      codexUsage: null,
      publish: vi.fn(),
      intervalMs: 1_000,
      now: () => NOW_MS
    })

    vi.advanceTimersByTime(2_500)
    expect(getAutomationRunUsage).toHaveBeenCalledTimes(1)

    resolveUsage?.(knownUsage(0.5))
    vi.useRealTimers()
  })

  it('stop() clears the interval so tickOnce no longer runs on a schedule', () => {
    vi.useFakeTimers()
    const getDb = vi.fn(() => db)
    publisher = startRunCostPublisher({
      getDb,
      claudeUsage: null,
      codexUsage: null,
      publish: vi.fn(),
      intervalMs: 1_000
    })
    publisher.stop()
    vi.advanceTimersByTime(5_000)
    expect(getDb).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
