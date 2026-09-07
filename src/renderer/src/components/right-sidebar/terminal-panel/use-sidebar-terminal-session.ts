import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { Tab } from '../../../../../shared/tab-types'

export type SidebarTerminalSession = { groupId: string; tabId: string }

/** The sidebar terminal already open for this worktree, if any. */
export function findSidebarTerminalSession(
  groups: readonly { id: string; surface?: 'sidebar' }[] | undefined,
  unifiedTabs: readonly Tab[] | undefined
): SidebarTerminalSession | null {
  const group = groups?.find((candidate) => candidate.surface === 'sidebar')
  if (!group) {
    return null
  }
  const tab = unifiedTabs?.find(
    (candidate) => candidate.groupId === group.id && candidate.contentType === 'terminal'
  )
  return tab ? { groupId: group.id, tabId: tab.entityId } : null
}

/**
 * One terminal session per worktree, hosted by the right sidebar. Created on the panel's first
 * open for that worktree and kept afterwards, so toggling the panel does not restart the shell.
 * The group carries the real worktreeId, so SSH and folder workspaces resolve their host exactly
 * as the main area does.
 */
export function useSidebarTerminalSession(
  worktreeId: string | null,
  enabled: boolean
): SidebarTerminalSession | null {
  const existing = useAppStore((s) =>
    worktreeId
      ? findSidebarTerminalSession(
          s.groupsByWorktree[worktreeId],
          s.unifiedTabsByWorktree[worktreeId]
        )
      : null
  )
  // Why a ref, not state: this only guards against a second create for the same worktree while
  // the store write settles, and nothing renders from it — state here would be an adjust-on-prop-
  // change effect (react-doctor) for a value the store already owns.
  const requestedForWorktreeRef = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || !worktreeId || existing || requestedForWorktreeRef.current === worktreeId) {
      return
    }
    requestedForWorktreeRef.current = worktreeId
    const store = useAppStore.getState()
    const groupId = store.ensureSidebarTerminalGroup(worktreeId)
    // activate: false — the sidebar's session must not steal focus from the main area's tab.
    store.createTab(worktreeId, groupId, undefined, { activate: false })
  }, [enabled, existing, worktreeId])
  return existing
}
