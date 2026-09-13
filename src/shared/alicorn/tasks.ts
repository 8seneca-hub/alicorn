// Hand-mirrored from cloud/packages/control-plane-contract/src/task.ts.
// Field names must stay identical — the desktop does not import the contract package, so a
// rename there is a silent break here.

import type { ExecutionStrategy } from './ledger'
import type { TaskProvider } from '../task-providers'

/**
 * A task: the unit of work (PRODUCT-ARCHITECTURE §2), and the thing the board is a board of.
 *
 * The `(repo, branch, worktree)` tuples a task binds are *not* here — they live in the client's
 * orchestration SQLite (`alicorn_task_worktrees`), because execution is on the client and a
 * worktree path names nothing on another host. A task is the ticket; the tuples are how it is
 * being worked on, and a task with none is a perfectly ordinary not-yet-started task.
 */
/**
 * Where a task came from, when it was not typed here. `ref` is the human id (`ALC-11`) and is what
 * a re-import dedupes on — a provider's internal uuid is not what a person recognises in the list.
 */
export type TaskSource = {
  provider: TaskProvider
  ref: string
  url: string | null
}

export type TaskInput = {
  projectId: string
  title: string
  /** The brief: what the agent cannot read off the repo. */
  context: string
  /** A board column id — one of Alicorn's workspace statuses. */
  column: string
  executionStrategy: ExecutionStrategy
  stageKey: string | null
  memberIds: string[]
  /** Null for a task typed here; set for one imported from a PM tool. */
  source: TaskSource | null
}

export type Task = Omit<TaskInput, 'projectId'> & {
  id: string
  tenantId: string
  projectId: string
  /** Per-project sequence; the displayed id is composed with the project key by `taskRef`. */
  number: number
  createdBy: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

/** Every field optional: the board moves one column, the composer edits one title. */
export type TaskPatch = Partial<Omit<TaskInput, 'projectId'>>

/** The column that means finished — mirrors the contract's `TASK_DONE_COLUMN`. */
export const TASK_DONE_COLUMN = 'completed'

/** `PAY-142`. The one place the display id is composed, so every surface spells it the same. */
export function taskRef(projectKey: string, number: number): string {
  return `${projectKey}-${number}`
}
