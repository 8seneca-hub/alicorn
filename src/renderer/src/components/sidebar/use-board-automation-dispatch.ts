import { useCallback } from 'react'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorkspaceStatus, isWorkspaceStatusId } from '../../../../shared/workspace-statuses'
import type { WorkspaceStatus, WorkspaceStatusDefinition } from '../../../../shared/worktree/types'

/**
 * Tells main that workspaces entered a column, so a matching rule can dispatch its member.
 *
 * Fire-and-forget by design: this rides a board move, and a rule that cannot dispatch must never
 * make the card fail to move. Refusals are recorded in main where the board's switch shows them.
 *
 * A code stage finishes inline and hands the workspace along its own forward or correction edge.
 * Main resolves which edge that is — the workflow is its to read — and answers with the column,
 * which `onAutomationMove` applies through the ordinary move path so the write, the task-status
 * sync and the guard rails are the same ones a human's drag gets.
 */
export function useBoardAutomationDispatch(args: {
  worktreeById: ReadonlyMap<string, Worktree>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  onAutomationMove?: (worktreeId: string, status: WorkspaceStatus) => void
}): (worktreeIds: readonly string[], status: WorkspaceStatus) => void {
  const { worktreeById, workspaceStatuses, onAutomationMove } = args
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
          .then((result) => {
            // Validated against the board's own columns: a stage names a column id, and one that
            // has since been renamed away must not be written onto the workspace as a status
            // nothing renders.
            if (
              result?.moveToStatusId &&
              isWorkspaceStatusId(result.moveToStatusId, workspaceStatuses)
            ) {
              onAutomationMove?.(worktreeId, result.moveToStatusId)
            }
          })
          .catch(() => {
            // Main already logs and records; a failed notify must not surface on the board.
          })
      }
    },
    [worktreeById, workspaceStatuses, onAutomationMove]
  )
}
