/** @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow as DashboardAgentRowData } from '@/components/dashboard/useDashboardData'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CompactAgentRow } from './worktree-card-compact-agent-row'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/dashboard/use-agent-row-conversation-name', () => ({
  useAgentRowConversationName: () => null
}))

vi.mock('./CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownForPane: () => null
}))

const useDispatchCost = vi.fn()
vi.mock('@/hooks/useAlicornRunCost', () => ({ useDispatchCost: () => useDispatchCost() }))

function makeAgent(): DashboardAgentRowData {
  return {
    paneKey: 'tab-1:leaf-1',
    tab: { id: 'tab-1' },
    agentType: 'claude',
    state: 'working',
    startedAt: 500,
    entry: {
      prompt: 'do the task',
      state: 'working',
      stateStartedAt: 1000,
      paneKey: 'tab-1:leaf-1',
      updatedAt: 1000,
      orchestration: { dispatchId: 'dispatch_1' }
    }
  } as unknown as DashboardAgentRowData
}

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
  useDispatchCost.mockReset()
})

function renderRow(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <TooltipProvider>
        <CompactAgentRow agent={makeAgent()} now={2000} onActivate={() => {}} />
      </TooltipProvider>
    )
  })
  return container
}

describe('CompactAgentRow run-cost chip', () => {
  it('renders the em dash for a known dispatch with no cost figure yet, not nothing', () => {
    useDispatchCost.mockReturnValue({ status: 'known', costUsd: null })

    const container = renderRow()

    expect(container.textContent).toContain('—')
  })

  it('renders a formatted dollar figure for a known dispatch with a cost figure', () => {
    useDispatchCost.mockReturnValue({ status: 'known', costUsd: 1.5 })

    const container = renderRow()

    expect(container.textContent).toContain('$1.50')
  })

  it('renders no cost chip for a pending dispatch', () => {
    useDispatchCost.mockReturnValue({ status: 'pending', costUsd: null })

    const container = renderRow()

    expect(
      container.querySelector('[title="Estimated spend for this dispatch (API-equivalent)"]')
    ).toBeNull()
  })
})
