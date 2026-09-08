import { describe, expect, it, vi } from 'vitest'
import { createDispatchSpendReader } from './dispatch-spend-reader'
import type { RunDispatchRow } from '../../runtime/orchestration/db/alicorn/alicorn-rows'

function dispatch(overrides: Partial<RunDispatchRow> = {}): RunDispatchRow {
  return {
    dispatchId: 'ctx-1',
    taskId: 'task-1',
    worktreeId: 'wt-1',
    startOptions: '{"agent":"claude"}',
    memberBackend: null,
    dispatchedAt: '2026-09-08 10:00:00',
    completedAt: '2026-09-08 10:20:00',
    ...overrides
  }
}

function claudeStore(estimatedCostUsd: number | null) {
  return {
    getAutomationRunUsage: vi.fn().mockResolvedValue({
      status: 'known',
      provider: 'claude',
      model: 'opus',
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      providerSessionId: null,
      attribution: 'worktree',
      estimatedCostUsd
    })
  }
}

describe('createDispatchSpendReader', () => {
  it('prices a dispatch in cents from the same attribution the ledger records', async () => {
    const read = createDispatchSpendReader({
      claudeUsage: () => claudeStore(1.234),
      codexUsage: () => null
    })
    await expect(read(dispatch())).resolves.toBe(123)
  })

  it('falls back to the worker start options when no member is assigned', async () => {
    const store = claudeStore(0.5)
    const read = createDispatchSpendReader({ claudeUsage: () => store, codexUsage: () => null })
    await expect(read(dispatch({ memberBackend: null }))).resolves.toBe(50)
    expect(store.getAutomationRunUsage).toHaveBeenCalled()
  })

  it('answers null for a backend Alicorn does not price, never a guess', async () => {
    const read = createDispatchSpendReader({
      claudeUsage: () => claudeStore(9),
      codexUsage: () => null
    })
    await expect(read(dispatch({ memberBackend: 'grok' }))).resolves.toBeNull()
  })

  it('answers null when the usage store is not available', async () => {
    const read = createDispatchSpendReader({ claudeUsage: () => null, codexUsage: () => null })
    await expect(read(dispatch())).resolves.toBeNull()
  })
})
