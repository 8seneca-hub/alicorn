import { describe, expect, it } from 'vitest'
import type { Tab, TabGroup } from './tab-types'
import {
  numericLikeSessionIds,
  toSessionKeyedTabModel,
  toWorktreeKeyedTabModel,
  type WorktreeKeyedTabModel
} from './workspace-session-tab-model-v2'

function tab(id: string, worktreeId: string, groupId: string): Tab {
  return {
    id,
    entityId: `entity-${id}`,
    groupId,
    worktreeId,
    contentType: 'terminal',
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function group(id: string, worktreeId: string, tabOrder: string[]): TabGroup {
  return { id, worktreeId, activeTabId: tabOrder[0] ?? null, tabOrder }
}

const V1: WorktreeKeyedTabModel = {
  unifiedTabs: {
    'wt-1': [tab('t-1', 'wt-1', 'g-1'), tab('t-2', 'wt-1', 'g-1'), tab('t-3', 'wt-1', 'g-2')],
    'wt-2': [tab('/repo/a.ts', 'wt-2', 'g-3')]
  },
  tabGroups: {
    'wt-1': [group('g-1', 'wt-1', ['t-1', 't-2']), group('g-2', 'wt-1', ['t-3'])],
    'wt-2': [group('g-3', 'wt-2', ['/repo/a.ts'])]
  }
}

describe('session-keyed tab model', () => {
  // The whole migration rests on this: a workspace is a field on a session, so the two shapes are
  // inter-derivable and no old session can lose a tab by being read as v2.
  it('round-trips v1 through v2 unchanged, order included', () => {
    expect(toWorktreeKeyedTabModel(toSessionKeyedTabModel(V1))).toEqual(V1)
  })

  it('keeps tabs in their original order within a worktree', () => {
    const back = toWorktreeKeyedTabModel(toSessionKeyedTabModel(V1))

    expect(back.unifiedTabs['wt-1'].map((entry) => entry.id)).toEqual(['t-1', 't-2', 't-3'])
  })

  it('keys a session by its own id and keeps the workspace as a field', () => {
    const v2 = toSessionKeyedTabModel(V1)

    expect(Object.keys(v2.sessionsById)).toEqual(['t-1', 't-2', 't-3', '/repo/a.ts'])
    expect(v2.sessionsById['t-3'].worktreeId).toBe('wt-1')
    expect(v2.tabGroupsBySession['g-2'].worktreeId).toBe('wt-1')
  })

  it('carries an editor tab whose id is a file path', () => {
    const v2 = toSessionKeyedTabModel(V1)

    expect(toWorktreeKeyedTabModel(v2).unifiedTabs['wt-2'][0].id).toBe('/repo/a.ts')
  })

  it('produces empty models from an empty session', () => {
    expect(toSessionKeyedTabModel({ unifiedTabs: {}, tabGroups: {} })).toEqual({
      sessionsById: {},
      tabGroupsBySession: {}
    })
    expect(toWorktreeKeyedTabModel({ sessionsById: {}, tabGroupsBySession: {} })).toEqual({
      unifiedTabs: {},
      tabGroups: {}
    })
  })

  // A group whose worktree has no tabs must still survive, or a split pane vanishes on restart.
  it('keeps a group whose worktree contributed no tabs', () => {
    const v1: WorktreeKeyedTabModel = {
      unifiedTabs: {},
      tabGroups: { 'wt-9': [group('g-9', 'wt-9', [])] }
    }

    expect(toWorktreeKeyedTabModel(toSessionKeyedTabModel(v1))).toEqual(v1)
  })

  describe('insertion order is only trustworthy for non-index keys', () => {
    // JavaScript hoists integer-like keys to the front of an object, which would silently reorder
    // the tab strip. Real ids are UUIDs or file paths, so this is a guard rather than a case we
    // expect — but a silent reorder is exactly the failure a migration must not be able to have.
    it('flags an integer-like session id instead of trusting the order', () => {
      const v2 = toSessionKeyedTabModel({
        unifiedTabs: { 'wt-1': [tab('t-a', 'wt-1', 'g-1'), tab('7', 'wt-1', 'g-1')] },
        tabGroups: { 'wt-1': [group('g-1', 'wt-1', ['t-a', '7'])] }
      })

      expect(numericLikeSessionIds(v2)).toEqual(['7'])
      // With teeth: the flagged id really does reorder, so the guard is load-bearing rather than
      // decorative. '7' was authored second and comes back first.
      expect(toWorktreeKeyedTabModel(v2).unifiedTabs['wt-1'].map((entry) => entry.id)).toEqual([
        '7',
        't-a'
      ])
    })

    it('flags nothing for ordinary uuid and file-path ids', () => {
      expect(numericLikeSessionIds(toSessionKeyedTabModel(V1))).toEqual([])
    })
  })
})
