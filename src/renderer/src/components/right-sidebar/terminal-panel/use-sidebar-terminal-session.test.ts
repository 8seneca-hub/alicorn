import { describe, expect, it } from 'vitest'
import { findSidebarTerminalTabId } from './use-sidebar-terminal-session'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'

function terminalTab(id: string, surface?: TerminalTab['surface']): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId: 'wt-1',
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...(surface ? { surface } : {})
  }
}

describe('findSidebarTerminalTabId', () => {
  it('finds the sidebar-owned terminal', () => {
    expect(findSidebarTerminalTabId([terminalTab('main'), terminalTab('side', 'sidebar')])).toBe(
      'side'
    )
  })

  it('is null before the sidebar terminal exists', () => {
    expect(findSidebarTerminalTabId([terminalTab('main')])).toBeNull()
  })

  it('never returns a main-area terminal', () => {
    expect(findSidebarTerminalTabId([terminalTab('main'), terminalTab('other')])).toBeNull()
  })

  it('tolerates a worktree with nothing hydrated yet', () => {
    expect(findSidebarTerminalTabId(undefined)).toBeNull()
    expect(findSidebarTerminalTabId([])).toBeNull()
  })
})
