import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'

const WT = 'wt-1'

function resetTabState(): void {
  useAppStore.setState({
    groupsByWorktree: {},
    activeGroupIdByWorktree: {},
    layoutByWorktree: {},
    unifiedTabsByWorktree: {},
    tabsByWorktree: {},
    activeTabIdByWorktree: {}
  })
}

describe('createTab with a surface', () => {
  beforeEach(resetTabState)

  it('marks the runtime tab as surface-owned', () => {
    const tab = useAppStore.getState().createTab(WT, undefined, undefined, {
      activate: false,
      surface: 'sidebar'
    })
    expect(useAppStore.getState().tabsByWorktree[WT]?.map((entry) => entry.surface)).toEqual([
      'sidebar'
    ])
    expect(tab.worktreeId).toBe(WT)
  })

  // The whole point of the surface: nothing in the main tab model learns about this terminal, so
  // no layout reader has to remember to filter it out.
  it('writes no unified tab, group, layout or focus', () => {
    useAppStore.getState().createTab(WT, undefined, undefined, {
      activate: false,
      surface: 'sidebar'
    })
    const state = useAppStore.getState()
    expect(state.unifiedTabsByWorktree[WT] ?? []).toEqual([])
    expect(state.groupsByWorktree[WT] ?? []).toEqual([])
    expect(state.layoutByWorktree[WT]).toBeUndefined()
    expect(state.activeGroupIdByWorktree[WT]).toBeUndefined()
    expect(state.activeTabIdByWorktree[WT]).toBeUndefined()
  })

  it('still publishes the PTY and layout records the pane mounts against', () => {
    const tab = useAppStore.getState().createTab(WT, undefined, undefined, {
      activate: false,
      surface: 'sidebar'
    })
    const state = useAppStore.getState()
    expect(state.ptyIdsByTabId[tab.id]).toEqual([])
    expect(state.terminalLayoutsByTabId[tab.id]).toBeDefined()
  })

  it('leaves an existing main-area tab untouched', () => {
    const main = useAppStore.getState().createTab(WT)
    useAppStore.getState().createTab(WT, undefined, undefined, {
      activate: false,
      surface: 'sidebar'
    })
    const state = useAppStore.getState()
    expect(state.unifiedTabsByWorktree[WT]?.map((entry) => entry.entityId)).toEqual([main.id])
    expect(state.activeTabIdByWorktree[WT]).toBe(main.id)
    expect(state.layoutByWorktree[WT]).toEqual({
      type: 'leaf',
      groupId: state.groupsByWorktree[WT]?.[0]?.id
    })
  })

  // With teeth: the identical call without a surface does join the main tab model, so the
  // assertions above are the surface doing the work rather than an inert fixture.
  it('creates the unified tab and group when no surface is given', () => {
    useAppStore.getState().createTab(WT, undefined, undefined, { activate: false })
    const state = useAppStore.getState()
    expect(state.unifiedTabsByWorktree[WT] ?? []).toHaveLength(1)
    expect(state.groupsByWorktree[WT] ?? []).toHaveLength(1)
    expect(state.layoutByWorktree[WT]).toBeDefined()
  })
})
