import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { mergeRunCostSummaries, summarizeProjectRunCost } from './project-run-cost'

function entry(overrides: Partial<AgentStatusEntry> & { paneKey: string }): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    stateHistory: [],
    ...overrides
  }
}

const tab = (id: string): TerminalTab => ({ id }) as TerminalTab

describe('summarizeProjectRunCost', () => {
  it('sums the dispatches of the project’s worktrees, by tab and by stamp alike', () => {
    const summary = summarizeProjectRunCost({
      worktreeIds: ['wt-1', 'wt-2'],
      tabsByWorktree: { 'wt-1': [tab('tab-1')], 'wt-3': [tab('tab-3')] },
      agentStatusByPaneKey: {
        'tab-1:11111111-1111-4111-8111-111111111111': entry({
          paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
          orchestration: { taskId: 't', dispatchId: 'd-1' }
        }),
        // No tab in this renderer yet, but main stamped the worktree.
        'tab-9:22222222-2222-4222-8222-222222222222': entry({
          paneKey: 'tab-9:22222222-2222-4222-8222-222222222222',
          worktreeId: 'wt-2',
          orchestration: { taskId: 't', dispatchId: 'd-2' }
        }),
        // Another project's worktree.
        'tab-3:33333333-3333-4333-8333-333333333333': entry({
          paneKey: 'tab-3:33333333-3333-4333-8333-333333333333',
          orchestration: { taskId: 't', dispatchId: 'd-3' }
        })
      },
      costs: {
        'd-1': { costUsd: 1.5, status: 'known' },
        'd-2': { costUsd: 2.25, status: 'known' },
        'd-3': { costUsd: 99, status: 'known' }
      }
    })

    expect(summary).toEqual({ costUsd: 3.75, partial: false })
  })

  it('counts a dispatch once when two panes report it', () => {
    const summary = summarizeProjectRunCost({
      worktreeIds: ['wt-1'],
      tabsByWorktree: { 'wt-1': [tab('tab-1')] },
      agentStatusByPaneKey: {
        'tab-1:11111111-1111-4111-8111-111111111111': entry({
          paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
          orchestration: { taskId: 't', dispatchId: 'd-1' }
        }),
        'tab-1:22222222-2222-4222-8222-222222222222': entry({
          paneKey: 'tab-1:22222222-2222-4222-8222-222222222222',
          orchestration: { taskId: 't', dispatchId: 'd-1' }
        })
      },
      costs: { 'd-1': { costUsd: 4, status: 'known' } }
    })

    expect(summary).toEqual({ costUsd: 4, partial: false })
  })

  it('reports a floor when a dispatch of this project cannot be priced', () => {
    const summary = summarizeProjectRunCost({
      worktreeIds: ['wt-1'],
      tabsByWorktree: { 'wt-1': [tab('tab-1')] },
      agentStatusByPaneKey: {
        'tab-1:11111111-1111-4111-8111-111111111111': entry({
          paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
          orchestration: { taskId: 't', dispatchId: 'd-1' }
        }),
        'tab-1:22222222-2222-4222-8222-222222222222': entry({
          paneKey: 'tab-1:22222222-2222-4222-8222-222222222222',
          orchestration: { taskId: 't', dispatchId: 'd-2' }
        })
      },
      costs: {
        'd-1': { costUsd: 1, status: 'known' },
        'd-2': { costUsd: null, status: 'unavailable' }
      }
    })

    expect(summary).toEqual({ costUsd: 1, partial: true })
  })

  it('has nothing to state for a project that has never run', () => {
    expect(
      summarizeProjectRunCost({
        worktreeIds: ['wt-1'],
        tabsByWorktree: {},
        agentStatusByPaneKey: undefined,
        costs: {}
      })
    ).toEqual({ costUsd: null, partial: false })
  })
})

describe('mergeRunCostSummaries', () => {
  it('adds the figures and keeps any floor a floor', () => {
    expect(
      mergeRunCostSummaries([
        { costUsd: 1.5, partial: false },
        { costUsd: 2, partial: true },
        { costUsd: null, partial: false }
      ])
    ).toEqual({ costUsd: 3.5, partial: true })
  })

  it('has nothing to state when no project does', () => {
    expect(
      mergeRunCostSummaries([
        { costUsd: null, partial: false },
        { costUsd: null, partial: false }
      ])
    ).toEqual({ costUsd: null, partial: false })
  })
})
