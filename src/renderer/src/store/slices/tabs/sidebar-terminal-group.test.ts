import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'

const WT = 'wt-1'

function sidebarGroups(): { id: string; surface?: string }[] {
  return (useAppStore.getState().groupsByWorktree[WT] ?? []).filter(
    (group) => group.surface === 'sidebar'
  )
}

describe('ensureSidebarTerminalGroup', () => {
  beforeEach(() => {
    useAppStore.setState({
      groupsByWorktree: {},
      activeGroupIdByWorktree: {},
      layoutByWorktree: {},
      unifiedTabsByWorktree: {},
      tabsByWorktree: {}
    })
  })

  it('creates the sidebar group on first use and reuses it after', () => {
    const first = useAppStore.getState().ensureSidebarTerminalGroup(WT)
    const second = useAppStore.getState().ensureSidebarTerminalGroup(WT)
    expect(second).toBe(first)
    expect(sidebarGroups()).toHaveLength(1)
  })

  // Why: this group is hosted by the right sidebar; writing either field pulls the main view onto
  // a group it never renders (layoutSpanningGroups excludes it).
  it('touches neither the layout nor the active group', () => {
    useAppStore.getState().ensureSidebarTerminalGroup(WT)
    const state = useAppStore.getState()
    expect(state.layoutByWorktree[WT]).toBeUndefined()
    expect(state.activeGroupIdByWorktree[WT]).toBeUndefined()
  })

  it('leaves an existing main-area group and layout alone', () => {
    useAppStore.setState({
      groupsByWorktree: {
        [WT]: [{ id: 'main', worktreeId: WT, activeTabId: null, tabOrder: [] }]
      },
      activeGroupIdByWorktree: { [WT]: 'main' },
      layoutByWorktree: { [WT]: { type: 'leaf', groupId: 'main' } }
    })
    const sidebarId = useAppStore.getState().ensureSidebarTerminalGroup(WT)
    const state = useAppStore.getState()
    expect(state.layoutByWorktree[WT]).toEqual({ type: 'leaf', groupId: 'main' })
    expect(state.activeGroupIdByWorktree[WT]).toBe('main')
    expect(state.groupsByWorktree[WT]?.map((group) => group.id)).toEqual(['main', sidebarId])
  })

  it('keeps sidebar groups separate per worktree', () => {
    const a = useAppStore.getState().ensureSidebarTerminalGroup(WT)
    const b = useAppStore.getState().ensureSidebarTerminalGroup('wt-2')
    expect(b).not.toBe(a)
  })
})

describe('createTab into the sidebar group', () => {
  beforeEach(() => {
    useAppStore.setState({
      groupsByWorktree: {},
      activeGroupIdByWorktree: {},
      layoutByWorktree: {},
      unifiedTabsByWorktree: {},
      tabsByWorktree: {}
    })
  })

  // Why: a worktree whose main area has no tabs yet must not get its layout rooted at the
  // sidebar group — that renders the sidebar terminal in the main view.
  it('never seeds the main layout from a sidebar group', () => {
    const groupId = useAppStore.getState().ensureSidebarTerminalGroup(WT)
    useAppStore.getState().createTab(WT, groupId, undefined, { activate: false })
    expect(useAppStore.getState().layoutByWorktree[WT]).toBeUndefined()
  })

  it('puts the tab in the sidebar group, not the main one', () => {
    const groupId = useAppStore.getState().ensureSidebarTerminalGroup(WT)
    const tab = useAppStore.getState().createTab(WT, groupId, undefined, { activate: false })
    const unified = useAppStore.getState().unifiedTabsByWorktree[WT] ?? []
    expect(unified.filter((entry) => entry.groupId === groupId)).toHaveLength(1)
    expect(
      useAppStore.getState().groupsByWorktree[WT]?.find((g) => g.id === groupId)?.tabOrder
    ).toContain(tab.id)
  })
})
