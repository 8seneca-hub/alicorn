import { describe, expect, it } from 'vitest'
import type { AppState } from '../../types'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { projectWorktreeTabModelReconciliation } from './tabs-reconciliation'

const WORKTREE_ID = 'wt-1'

function terminalTab(overrides: Partial<TerminalTab> & { id: string }): TerminalTab {
  return {
    ptyId: 'pty-1',
    worktreeId: WORKTREE_ID,
    title: 'zsh',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

function stateWith(tabs: TerminalTab[]): AppState {
  return {
    unifiedTabsByWorktree: {},
    groupsByWorktree: {},
    activeGroupIdByWorktree: {},
    layoutByWorktree: {},
    tabsByWorktree: { [WORKTREE_ID]: tabs },
    activeTabIdByWorktree: {},
    ptyIdsByTabId: { 'sidebar-1': ['pty-1'], 'main-1': ['pty-1'] },
    terminalLayoutsByTabId: {},
    lastKnownRelayPtyIdByTabId: {},
    deferredSshSessionIdsByTabId: {},
    pendingReconnectPtyIdByTabId: {},
    unverifiedPtyLossTabIds: {},
    unreadTerminalTabs: {},
    openFiles: [],
    browserTabsByWorktree: {},
    tabBarOrderByWorktree: {}
  } as unknown as AppState
}

describe('reconciliation and surface-owned terminals', () => {
  // The sidebar terminal keeps the real worktree id so SSH and folder workspaces resolve normally.
  // That puts it in this worktree's runtime tabs, where "has no unified tab" is the exact test for
  // a legacy tab to adopt — so without the exemption the sidebar's terminal is pulled into the tab
  // strip and the split layout, which is the whole thing the panel exists to avoid.
  it('does not adopt a sidebar-owned terminal into the unified model', () => {
    const projected = projectWorktreeTabModelReconciliation(
      stateWith([terminalTab({ id: 'sidebar-1', surface: 'sidebar' })]),
      WORKTREE_ID
    )

    expect(projected.patch.unifiedTabsByWorktree?.[WORKTREE_ID] ?? []).toEqual([])
    expect(projected.renderableTabCount).toBe(0)
  })

  // With teeth: the identical terminal without the marker is adopted, so the exemption is what
  // keeps it out rather than the fixture failing to look reconnectable.
  it('adopts the same terminal when it is not surface-owned', () => {
    const projected = projectWorktreeTabModelReconciliation(
      stateWith([terminalTab({ id: 'main-1' })]),
      WORKTREE_ID
    )

    expect(
      (projected.patch.unifiedTabsByWorktree?.[WORKTREE_ID] ?? []).map((tab) => tab.entityId)
    ).toEqual(['main-1'])
  })
})
