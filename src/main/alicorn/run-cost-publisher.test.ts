import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { startRunCostPublisher, type RunCostPublisher } from './run-cost-publisher'
import type { AutomationRunUsage } from '../../shared/automations-types'

const NOW_MS = Date.UTC(2026, 8, 6, 12, 0, 0)
const LAST_SCAN_MS = Date.UTC(2026, 8, 6, 11, 55, 0)

function knownUsage(estimatedCostUsd: number): AutomationRunUsage {
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

  function startDispatchedWorker(startOptions: unknown): string {
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
