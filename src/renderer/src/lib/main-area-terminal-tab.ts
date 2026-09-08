import { isSurfaceOwnedTerminalTab } from '../../../shared/terminal-tab-types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'

/**
 * The first terminal a workspace should deliver unattended work to — setup scripts, issue-commands,
 * hook commands, agent startup.
 *
 * Why not `tabsByWorktree[worktreeId]?.[0]`: a surface-owned terminal (the right-sidebar one) lives
 * in that same map, so index 0 can be a pane the user did not open for this and may not be watching,
 * while the main-area terminal they *are* watching sits idle and looks broken. Setup scripts run
 * arbitrary project commands, so the wrong target is not cosmetic.
 */
export function findFirstMainAreaTerminalTabId(
  terminalTabs: readonly Pick<TerminalTab, 'id' | 'surface'>[] | undefined
): string | undefined {
  return terminalTabs?.find((tab) => !isSurfaceOwnedTerminalTab(tab))?.id
}
