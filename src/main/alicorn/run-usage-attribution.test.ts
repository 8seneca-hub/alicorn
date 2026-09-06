import { describe, expect, it, vi } from 'vitest'
import type { AutomationRunUsage } from '../../shared/automations-types'
import { attributeDispatchUsage, parseSqliteUtc } from './run-usage-attribution'

function knownUsage(overrides?: Partial<AutomationRunUsage>): AutomationRunUsage {
  return {
    status: 'known',
    provider: 'claude',
    model: 'claude-opus-4',
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 10,
    cacheWriteTokens: 5,
    reasoningOutputTokens: null,
    totalTokens: 315,
    estimatedCostUsd: 0.8234,
    estimatedCostSource: 'api_equivalent',
    providerSessionId: 'sess_1',
    attribution: 'provider_session_time_window',
    collectedAt: 1_700_000_000_000,
    unavailableReason: null,
    unavailableMessage: null,
    ...overrides
  }
}

function unavailableUsage(
  reason: AutomationRunUsage['unavailableReason'],
  message: string
): AutomationRunUsage {
  return {
    status: 'unavailable',
    provider: 'claude',
    model: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningOutputTokens: null,
    totalTokens: null,
    estimatedCostUsd: null,
    estimatedCostSource: null,
    providerSessionId: null,
    attribution: null,
    collectedAt: 1_700_000_000_000,
    unavailableReason: reason,
    unavailableMessage: message
  }
}

describe('parseSqliteUtc', () => {
  it('parses a SQLite UTC timestamp string to epoch ms', () => {
    expect(parseSqliteUtc('2026-09-06 01:02:03')).toBe(Date.UTC(2026, 8, 6, 1, 2, 3))
  })

  it('returns null for a null input', () => {
    expect(parseSqliteUtc(null)).toBeNull()
  })
})

describe('attributeDispatchUsage', () => {
  it('maps known Claude usage to spend cents and a plain-JSON usage patch', async () => {
    const getAutomationRunUsage = vi.fn().mockResolvedValue(knownUsage())
    const patch = await attributeDispatchUsage({
      backend: 'claude',
      worktreeId: 'wt_1',
      startedAt: '2026-09-06 01:00:00',
      completedAt: '2026-09-06 01:05:00',
      claudeUsage: { getAutomationRunUsage },
      codexUsage: null
    })

    expect(patch.spendCents).toBe(82)
    expect(patch.usage).toEqual({
      status: 'known',
      provider: 'claude',
      model: 'claude-opus-4',
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      providerSessionId: 'sess_1',
      attribution: 'provider_session_time_window'
    })
    expect(getAutomationRunUsage).toHaveBeenCalledWith({
      worktreeId: 'wt_1',
      terminalSessionId: null,
      startedAt: Date.UTC(2026, 8, 6, 1, 0, 0),
      completedAt: Date.UTC(2026, 8, 6, 1, 5, 0)
    })
  })

  it('returns null spend with the reason when usage is ambiguous', async () => {
    const getAutomationRunUsage = vi
      .fn()
      .mockResolvedValue(
        unavailableUsage(
          'ambiguous_session',
          'Multiple Claude usage sessions matched this run window.'
        )
      )
    const patch = await attributeDispatchUsage({
      backend: 'claude',
      worktreeId: 'wt_1',
      startedAt: '2026-09-06 01:00:00',
      completedAt: '2026-09-06 01:05:00',
      claudeUsage: { getAutomationRunUsage },
      codexUsage: null
    })

    expect(patch).toEqual({
      spendCents: null,
      usage: {
        status: 'unavailable',
        unavailableReason: 'ambiguous_session',
        unavailableMessage: 'Multiple Claude usage sessions matched this run window.'
      }
    })
  })

  it('returns provider_unsupported for a backend that is neither Claude nor Codex', async () => {
    const patch = await attributeDispatchUsage({
      backend: 'grok',
      worktreeId: null,
      startedAt: null,
      completedAt: null,
      claudeUsage: null,
      codexUsage: null
    })

    expect(patch).toEqual({
      spendCents: null,
      usage: { status: 'unavailable', unavailableReason: 'provider_unsupported' }
    })
  })

  it('routes Codex dispatches to the Codex store, not the Claude store', async () => {
    const claudeGetAutomationRunUsage = vi.fn()
    const codexGetAutomationRunUsage = vi
      .fn()
      .mockResolvedValue(
        knownUsage({ provider: 'codex', model: 'gpt-5-codex', estimatedCostUsd: 2.5 })
      )
    const patch = await attributeDispatchUsage({
      backend: 'codex',
      worktreeId: 'wt_2',
      startedAt: '2026-09-06 01:00:00',
      completedAt: '2026-09-06 01:05:00',
      claudeUsage: { getAutomationRunUsage: claudeGetAutomationRunUsage },
      codexUsage: { getAutomationRunUsage: codexGetAutomationRunUsage }
    })

    expect(claudeGetAutomationRunUsage).not.toHaveBeenCalled()
    expect(codexGetAutomationRunUsage).toHaveBeenCalledTimes(1)
    expect(patch.spendCents).toBe(250)
    expect(patch.usage).toMatchObject({ status: 'known', provider: 'codex', model: 'gpt-5-codex' })
  })

  it('is unavailable with a clear reason when the backend has no usage store wired', async () => {
    const patch = await attributeDispatchUsage({
      backend: 'claude',
      worktreeId: 'wt_1',
      startedAt: null,
      completedAt: null,
      claudeUsage: null,
      codexUsage: null
    })

    expect(patch.spendCents).toBeNull()
    expect(patch.usage).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'usage_not_enabled'
    })
  })
})
