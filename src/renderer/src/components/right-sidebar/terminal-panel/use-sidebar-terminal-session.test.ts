import { describe, expect, it } from 'vitest'
import { findSidebarTerminalSession } from './use-sidebar-terminal-session'
import type { Tab, TabGroup } from '../../../../../shared/tab-types'

function group(id: string, surface?: TabGroup['surface']): TabGroup {
  return {
    id,
    worktreeId: 'wt-1',
    activeTabId: null,
    tabOrder: [],
    ...(surface ? { surface } : {})
  }
}

function tab(id: string, groupId: string, contentType: Tab['contentType'] = 'terminal'): Tab {
  return {
    id,
    entityId: `pty-${id}`,
    groupId,
    worktreeId: 'wt-1',
    contentType,
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

describe('findSidebarTerminalSession', () => {
  it('finds the terminal in the sidebar-owned group', () => {
    expect(
      findSidebarTerminalSession(
        [group('main'), group('side', 'sidebar')],
        [tab('a', 'main'), tab('b', 'side')]
      )
    ).toEqual({ groupId: 'side', tabId: 'pty-b' })
  })

  it('is null before the sidebar group exists', () => {
    expect(findSidebarTerminalSession([group('main')], [tab('a', 'main')])).toBeNull()
  })

  it('is null when the sidebar group has no terminal yet', () => {
    expect(findSidebarTerminalSession([group('side', 'sidebar')], [])).toBeNull()
  })

  // Why: the panel hosts a TerminalPane, so a non-terminal tab in that group is not a session.
  it('ignores a non-terminal tab in the sidebar group', () => {
    expect(
      findSidebarTerminalSession([group('side', 'sidebar')], [tab('a', 'side', 'editor')])
    ).toBeNull()
  })

  it('never returns a main-area terminal', () => {
    expect(
      findSidebarTerminalSession([group('main'), group('side', 'sidebar')], [tab('a', 'main')])
    ).toBeNull()
  })

  it('tolerates a worktree with nothing hydrated yet', () => {
    expect(findSidebarTerminalSession(undefined, undefined)).toBeNull()
  })
})
