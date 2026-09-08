import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'

/** The sidebar terminal already open for this worktree, if any. */
export function findSidebarTerminalTabId(
  terminalTabs: readonly TerminalTab[] | undefined
): string | null {
  return terminalTabs?.find((tab) => tab.surface === 'sidebar')?.id ?? null
}

/**
 * One terminal session per worktree, hosted by the right sidebar. Created on the panel's first
 * open for that worktree and kept afterwards, so toggling the panel does not restart the shell.
 * The tab carries the real worktreeId, so SSH and folder workspaces resolve their host exactly
 * as the main area does; `surface` is what keeps it out of the main tab area, by leaving it with
 * no unified `Tab` at all.
 */
export function useSidebarTerminalSession(
  worktreeId: string | null,
  enabled: boolean
): string | null {
  const tabId = useAppStore((s) =>
    worktreeId ? findSidebarTerminalTabId(s.tabsByWorktree[worktreeId]) : null
  )
  // Why a ref, not state: this only guards against a second create for the same worktree while
  // the store write settles, and nothing renders from it — state here would be an adjust-on-prop-
  // change effect (react-doctor) for a value the store already owns.
  const requestedForWorktreeRef = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || !worktreeId || tabId || requestedForWorktreeRef.current === worktreeId) {
      return
    }
    requestedForWorktreeRef.current = worktreeId
    // activate: false — the sidebar's session must not steal focus from the main area's tab.
    useAppStore
      .getState()
      .createTab(worktreeId, undefined, undefined, { activate: false, surface: 'sidebar' })
  }, [enabled, tabId, worktreeId])
  return tabId
}
