import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import type { AlicornPaneRole } from './agent-pane-role'

/**
 * The two ways a restricted pane can be asked for and not delivered.
 *
 * Shared by every entry point that can start one — worker start and dispatch-to-a-running-terminal
 * — because the failure they prevent is silent: a lead that can write code, or a QA member that can
 * read the implementation, in a run that still reports otherwise. One copy, so a new entry point
 * cannot quietly ship without the refusal.
 */
function label(role: AlicornPaneRole): string {
  return role === 'lead' ? 'lead' : 'QA member'
}

export function restrictedLaunchWorktreeError(role: AlicornPaneRole): OrchestrationError {
  return new OrchestrationError(
    `${role}_worktree_unsupported`,
    role === 'lead'
      ? 'A lead writes no code and needs no worktree of its own: dispatch it into an existing worktree.'
      : 'A QA member is sandboxed at launch, and worktree creation has no seam for that yet: dispatch it into an existing worktree.'
  )
}

export function restrictedLaunchTerminalReuseError(role: AlicornPaneRole): OrchestrationError {
  return new OrchestrationError(
    `${role}_terminal_reuse_unsupported`,
    `A ${label(role)} is restricted at launch, so it cannot take over a running agent terminal: start it with \`worker start --member\` instead.`
  )
}
