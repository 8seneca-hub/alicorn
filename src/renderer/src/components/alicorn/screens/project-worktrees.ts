/**
 * A project's work, which is Orca's worktrees under the repositories the project owns.
 *
 * No new store: the board and the task list are two readings of the same rows the workspace
 * sidebar already holds, so they stay correct whenever it does. A project that owns no repository
 * has no work, which is a real answer rather than an empty board that looks broken.
 */
import type { Worktree, WorkspaceStatusDefinition } from '../../../../../shared/worktree/types'

export type ProjectWorktreeColumn = {
  status: WorkspaceStatusDefinition
  worktrees: Worktree[]
}

export function projectWorktrees(
  worktreesByRepo: Record<string, Worktree[]>,
  repoIds: readonly string[]
): Worktree[] {
  return repoIds.flatMap((repoId) => worktreesByRepo[repoId] ?? [])
}

/**
 * Groups by status, keeping every column the workspace defines even when it is empty — a board
 * that hides its empty columns moves its other columns every time a card lands, which makes the
 * position of a column useless as a thing to aim at.
 *
 * A worktree whose status is unset or names a status the workspace no longer defines falls into
 * the first column, because dropping it would lose work from a board that claims to show all of it.
 */
export function groupWorktreesByStatus(
  worktrees: readonly Worktree[],
  statuses: readonly WorkspaceStatusDefinition[]
): ProjectWorktreeColumn[] {
  if (statuses.length === 0) {
    return []
  }
  const columns: ProjectWorktreeColumn[] = statuses.map((status) => ({ status, worktrees: [] }))
  const byId = new Map(columns.map((column) => [column.status.id, column]))
  for (const worktree of worktrees) {
    const column = worktree.workspaceStatus ? byId.get(worktree.workspaceStatus) : undefined
    ;(column ?? columns[0]!).worktrees.push(worktree)
  }
  return columns
}
