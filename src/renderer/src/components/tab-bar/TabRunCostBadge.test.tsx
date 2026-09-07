// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabRunCostBadge } from './TabRunCostBadge'
import { useAppStore } from '@/store'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { RunCostByDispatch } from '../../../../shared/alicorn/run-cost'

let costs: RunCostByDispatch = {}

vi.mock('@/store/alicorn-run-cost-store', () => ({
  subscribeAlicornRunCost: () => () => {},
  getAlicornRunCostSnapshot: () => costs
}))

const LEAF = '11111111-1111-4111-8111-111111111111'

function pane(tabId: string, dispatchId: string): Record<string, AgentStatusEntry> {
  const paneKey = `${tabId}:${LEAF}`
  return {
    [paneKey]: {
      paneKey,
      worktreeId: 'wt-1',
      state: 'working',
      stateStartedAt: 0,
      updatedAt: 0,
      stateHistory: [],
      orchestration: { taskId: 'task-1', dispatchId }
    } as unknown as AgentStatusEntry
  }
}

function renderBadge(): void {
  render(
    <TooltipProvider>
      <TabRunCostBadge tabId="tab-1" />
    </TooltipProvider>
  )
}

describe('TabRunCostBadge', () => {
  beforeEach(() => {
    costs = {}
    useAppStore.setState({ agentStatusByPaneKey: {} })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the tab’s running spend', () => {
    costs = { 'd-1': { costUsd: 0.42, status: 'known' } }
    useAppStore.setState({ agentStatusByPaneKey: pane('tab-1', 'd-1') })
    renderBadge()
    expect(screen.getByTestId('tab-run-cost')).toHaveTextContent('$0.42')
  })

  it('marks a floor as a floor, never as a total', () => {
    costs = { 'd-1': { costUsd: null, status: 'unavailable' } }
    useAppStore.setState({ agentStatusByPaneKey: pane('tab-1', 'd-1') })
    renderBadge()
    // Nothing priced at all: a dash, never a guess.
    expect(screen.getByTestId('tab-run-cost')).toHaveTextContent('—')
  })

  it('renders nothing for a tab that has not dispatched', () => {
    renderBadge()
    expect(screen.queryByTestId('tab-run-cost')).toBeNull()
  })

  it('ignores another tab’s dispatch', () => {
    costs = { 'd-2': { costUsd: 9.99, status: 'known' } }
    useAppStore.setState({ agentStatusByPaneKey: pane('tab-2', 'd-2') })
    renderBadge()
    expect(screen.queryByTestId('tab-run-cost')).toBeNull()
  })
})
