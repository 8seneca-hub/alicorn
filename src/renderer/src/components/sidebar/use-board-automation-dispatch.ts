import { useCallback } from 'react'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorkspaceStatus } from '../../../../shared/workspace-statuses'
import type { WorkspaceStatus, WorkspaceStatusDefinition } from '../../../../shared/worktree/types'

/**
 * Tells main that workspaces entered a column, so a matching rule can dispatch its member.
 *
 * Fire-and-forget by design: this rides a board move, and a rule that cannot dispatch must never
 * make the card fail to move. Refusals are recorded in main where the board's switch shows them.
 */
export function useBoardAutomationDispatch(args: {
  worktreeById: ReadonlyMap<string, Worktree>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
}): (worktreeIds: readonly string[], status: WorkspaceStatus) => void {
  const { worktreeById, workspaceStatuses } = args
  return useCallback(
    (worktreeIds, status) => {
      for (const worktreeId of worktreeIds) {
        const worktree = worktreeById.get(worktreeId)
        // Why skip a repo-less workspace: rules are bound to a board, and a workspace with no repo
        // belongs to none.
        if (!worktree?.repoId) {
          continue
        }
        // Why optional: the web client's preload surface does not carry board automation, and a
        // board move must not throw there. No bridge simply means no dispatch.
        const bridge = window.api?.boardAutomation
        if (!bridge?.statusChanged) {
          continue
        }
        void bridge
          .statusChanged({
            worktreeId,
            repoId: worktree.repoId,
            fromStatusId: getWorkspaceStatus(worktree, workspaceStatuses) ?? null,
            toStatusId: status,
            worktreePath: worktree.path,
            issueRef: worktree.linkedWorkItem?.planeIdentifier ?? null,
            workspaceName: worktree.displayName || null
          })
          .catch(() => {
            // Main already logs and records; a failed notify must not surface on the board.
          })
      }
    },
    [worktreeById, workspaceStatuses]
  )
}
