import TerminalPane from '@/components/terminal-pane/TerminalPane'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { shouldDeferParkedPtyExitTabClose } from '@/components/terminal-pane/terminal-parked-tab-watchers'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isProvenProcessExit } from '../../../../../shared/terminal-exit-cause'
import { useSidebarTerminalSession } from './use-sidebar-terminal-session'

/**
 * The terminal, in the right sidebar. An ADE opens an agent by default and keeps the shell one
 * keystroke away (CLAUDE.md → *Interface decisions*), so this hosts the same `TerminalPane` the
 * main area does — one session per worktree, on the worktree's own execution host.
 */
export function TerminalPanel({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const tabId = useSidebarTerminalSession(worktreeId, isVisible)

  if (!worktreeId) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {translate(
          'auto.components.right.sidebar.terminal.panel.TerminalPanel.noWorkspace',
          'Open a workspace to use the terminal.'
        )}
      </div>
    )
  }

  if (!tabId) {
    return <div className="p-3 text-xs text-muted-foreground" />
  }

  return (
    <div className="relative min-h-0 flex-1">
      <TerminalPane
        tabId={tabId}
        worktreeId={worktreeId}
        isActive
        // Why gate on isVisible: a closed panel is CSS-hidden, so this routes the pane through
        // the standard hidden-terminal suspend/resume path instead of holding a live WebGL
        // context (same reasoning as the floating terminal).
        isVisible={isVisible}
        showSplitButton={false}
        onPtyExit={(ptyId, exitCode) => {
          if (exitCode !== undefined && !isProvenProcessExit(exitCode)) {
            useAppStore.getState().markUnverifiedPtyLoss(tabId)
            return
          }
          if (shouldDeferParkedPtyExitTabClose(tabId, ptyId)) {
            return
          }
          closeTerminalTab(tabId, { reason: 'pty-exit', lifecyclePtyId: ptyId })
        }}
        onCloseTab={() => {
          closeTerminalTab(tabId, { reason: 'user' })
        }}
      />
    </div>
  )
}

export default TerminalPanel
