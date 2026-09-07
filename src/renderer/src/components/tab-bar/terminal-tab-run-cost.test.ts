import { describe, expect, it } from 'vitest'
import { resolveTerminalTabRunCost } from './terminal-tab-run-cost'
import { formatRunCostSummary } from '../../../../shared/alicorn/run-cost'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { RunCostByDispatch } from '../../../../shared/alicorn/run-cost'

const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

function entry(paneKey: string, dispatchId?: string): AgentStatusEntry {
  return {
    paneKey,
    worktreeId: 'wt-1',
    state: 'working',
    stateStartedAt: 0,
    updatedAt: 0,
    stateHistory: [],
    ...(dispatchId ? { orchestration: { taskId: 'task-1', dispatchId } } : {})
  } as unknown as AgentStatusEntry
}

describe('resolveTerminalTabRunCost', () => {
  it('sums the dispatches of every pane in the tab', () => {
    const costs: RunCostByDispatch = {
      'd-1': { costUsd: 0.3, status: 'known' },
      'd-2': { costUsd: 0.12, status: 'known' }
    }
    const summary = resolveTerminalTabRunCost({
      tabId: 'tab-1',
      agentStatusByPaneKey: {
        [`tab-1:${LEAF_A}`]: entry(`tab-1:${LEAF_A}`, 'd-1'),
        [`tab-1:${LEAF_B}`]: entry(`tab-1:${LEAF_B}`, 'd-2')
      },
      costs
    })
    expect(summary).toEqual({ costUsd: 0.42, partial: false })
    expect(formatRunCostSummary(summary)).toBe('$0.42')
  })

  it('reads a floor, not a total, when one dispatch is unpriced', () => {
    const summary = resolveTerminalTabRunCost({
      tabId: 'tab-1',
      agentStatusByPaneKey: {
        [`tab-1:${LEAF_A}`]: entry(`tab-1:${LEAF_A}`, 'd-1'),
        [`tab-1:${LEAF_B}`]: entry(`tab-1:${LEAF_B}`, 'd-2')
      },
      costs: {
        'd-1': { costUsd: 0.42, status: 'known' },
        'd-2': { costUsd: null, status: 'unavailable' }
      }
    })
    expect(summary).toEqual({ costUsd: 0.42, partial: true })
    expect(formatRunCostSummary(summary)).toBe('≥ $0.42 (partial)')
  })

  it('never guesses: a tab with no dispatch has no cost', () => {
    const summary = resolveTerminalTabRunCost({
      tabId: 'tab-1',
      agentStatusByPaneKey: { [`tab-1:${LEAF_A}`]: entry(`tab-1:${LEAF_A}`) },
      costs: {}
    })
    expect(summary).toEqual({ costUsd: null, partial: false })
    expect(formatRunCostSummary(summary)).toBe('—')
  })

  it('ignores panes belonging to another tab', () => {
    const summary = resolveTerminalTabRunCost({
      tabId: 'tab-1',
      agentStatusByPaneKey: {
        [`tab-1:${LEAF_A}`]: entry(`tab-1:${LEAF_A}`, 'd-1'),
        [`tab-2:${LEAF_B}`]: entry(`tab-2:${LEAF_B}`, 'd-2')
      },
      costs: {
        'd-1': { costUsd: 0.5, status: 'known' },
        'd-2': { costUsd: 9.99, status: 'known' }
      }
    })
    expect(summary).toEqual({ costUsd: 0.5, partial: false })
  })

  // Why: restored sessions still carry pre-UUID numeric pane keys — same parse as the status dot.
  it('attributes a legacy numeric pane key to its tab', () => {
    const summary = resolveTerminalTabRunCost({
      tabId: 'tab-1',
      agentStatusByPaneKey: { 'tab-1:0': entry('tab-1:0', 'd-1') },
      costs: { 'd-1': { costUsd: 0.25, status: 'known' } }
    })
    expect(summary).toEqual({ costUsd: 0.25, partial: false })
  })

  it('counts a dispatch once when two panes report the same one', () => {
    const summary = resolveTerminalTabRunCost({
      tabId: 'tab-1',
      agentStatusByPaneKey: {
        [`tab-1:${LEAF_A}`]: entry(`tab-1:${LEAF_A}`, 'd-1'),
        [`tab-1:${LEAF_B}`]: entry(`tab-1:${LEAF_B}`, 'd-1')
      },
      costs: { 'd-1': { costUsd: 0.4, status: 'known' } }
    })
    expect(summary).toEqual({ costUsd: 0.4, partial: false })
  })

  it('has no cost for a tab with no panes at all', () => {
    expect(
      resolveTerminalTabRunCost({ tabId: 'tab-1', agentStatusByPaneKey: undefined, costs: {} })
    ).toEqual({ costUsd: null, partial: false })
  })
})
