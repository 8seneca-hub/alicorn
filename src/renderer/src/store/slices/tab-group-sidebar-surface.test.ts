import { describe, expect, it } from 'vitest'
import { layoutSpanningGroups } from './tab-group-reference-repair'
import { selectHydratedActiveGroupId } from './tab-group-state'
import type { TabGroup, TabGroupLayoutNode } from '../../../../shared/tab-types'

function group(id: string, surface?: TabGroup['surface'], tabOrder: string[] = []): TabGroup {
  return {
    id,
    worktreeId: 'wt-1',
    activeTabId: null,
    tabOrder,
    ...(surface ? { surface } : {})
  }
}

function leafIds(node: TabGroupLayoutNode, into: string[] = []): string[] {
  if (node.type === 'leaf') {
    into.push(node.groupId)
    return into
  }
  leafIds(node.first, into)
  leafIds(node.second, into)
  return into
}

describe('layoutSpanningGroups — sidebar-owned groups', () => {
  it('lays out every main-area group', () => {
    const layout = layoutSpanningGroups([group('a'), group('b')], null)
    expect(leafIds(layout)).toEqual(['a', 'b'])
  })

  // Why: the right-sidebar terminal owns a real group on the real worktree (so SSH and folder
  // workspaces resolve its host), and must not surface as a split in the main view.
  it('keeps a sidebar-owned group out of the main layout', () => {
    const layout = layoutSpanningGroups([group('a'), group('sidebar', 'sidebar')], null)
    expect(leafIds(layout)).toEqual(['a'])
  })

  it('does not splice a sidebar group into an existing layout', () => {
    const existing: TabGroupLayoutNode = { type: 'leaf', groupId: 'a' }
    const layout = layoutSpanningGroups([group('a'), group('sidebar', 'sidebar')], existing)
    expect(leafIds(layout)).toEqual(['a'])
  })

  // Why: closing every main tab while the sidebar terminal lives must not produce an empty
  // layout tree — degrade to the pre-existing behaviour rather than render nothing.
  it('falls back to the surviving group when only a sidebar group is left', () => {
    const layout = layoutSpanningGroups([group('sidebar', 'sidebar')], null)
    expect(leafIds(layout)).toEqual(['sidebar'])
  })

  it('keeps an existing layout when only a sidebar group is left', () => {
    const existing: TabGroupLayoutNode = { type: 'leaf', groupId: 'a' }
    const layout = layoutSpanningGroups([group('sidebar', 'sidebar')], existing)
    expect(leafIds(layout)).toEqual(['a'])
  })
})

describe('selectHydratedActiveGroupId — sidebar-owned groups', () => {
  // Why: the sidebar group is not in the main layout, so focusing it would leave the main area
  // pointing at a group it never renders.
  it('never makes the sidebar group the main area’s active group', () => {
    expect(
      selectHydratedActiveGroupId([group('sidebar', 'sidebar', ['t-1']), group('a')], undefined)
    ).toBe('a')
  })

  it('ignores a persisted active id that points at the sidebar group', () => {
    expect(
      selectHydratedActiveGroupId([group('sidebar', 'sidebar', ['t-1']), group('a')], 'sidebar')
    ).toBe('a')
  })

  it('still prefers a main group that has tabs', () => {
    expect(
      selectHydratedActiveGroupId(
        [group('a'), group('b', undefined, ['t-2']), group('sidebar', 'sidebar', ['t-1'])],
        undefined
      )
    ).toBe('b')
  })

  it('returns nothing when the sidebar group is the only group', () => {
    expect(selectHydratedActiveGroupId([group('sidebar', 'sidebar', ['t-1'])], undefined)).toBe(
      undefined
    )
  })
})
