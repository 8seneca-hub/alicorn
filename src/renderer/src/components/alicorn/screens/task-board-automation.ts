/**
 * Making a task move dispatch a member.
 *
 * Board automation already turns a column change into a dispatch, keyed to a worktree and a
 * workspace status. A task column *is* a workspace status id — the board's columns are Orca's own
 * statuses — so a task that owns a workspace can drive the existing engine rather than needing a
 * second one. That is the whole join: without it, dragging a card updates a row in Postgres and
 * dispatches nobody, which is v1.0's exit criterion failing quietly.
 *
 * A task with no workspace dispatches nothing, and that is correct: there is nowhere to run.
 */
import type { TaskWorktreeTuple } from '../../../../../shared/alicorn/feature-workspace-tuples'
import type { Worktree } from '../../../../../shared/worktree/types'

export type TaskMoveAutomation = {
  worktreeId: string
  repoId: string
  worktreePath: string
  fromStatusId: string | null
  toStatusId: string
}

/**
 * What to tell the engine when a task moves, or null when nothing should be told.
 *
 * Null for a task with no bound workspace, and for one whose workspace this client cannot resolve
 * — a path belongs to its execution host, and inventing one would run the dispatch in the wrong
 * place. Silence is the safe direction: the card still moves, nothing is dispatched.
 */
export function planTaskMoveAutomation(args: {
  tuples: readonly TaskWorktreeTuple[]
  worktreesByRepo: Record<string, Worktree[]>
  fromColumn: string | null
  toColumn: string
}): TaskMoveAutomation | null {
  // The primary tuple is where a dispatch runs; `setTaskWorktrees` guarantees exactly one.
  const primary = args.tuples.find((tuple) => tuple.primary) ?? args.tuples[0]
  if (!primary || args.fromColumn === args.toColumn) {
    return null
  }
  const worktree = (args.worktreesByRepo[primary.repoId] ?? []).find(
    (candidate) => candidate.id === primary.worktreeId
  )
  if (!worktree?.path) {
    return null
  }
  return {
    worktreeId: primary.worktreeId,
    repoId: primary.repoId,
    worktreePath: worktree.path,
    fromStatusId: args.fromColumn,
    toStatusId: args.toColumn
  }
}
