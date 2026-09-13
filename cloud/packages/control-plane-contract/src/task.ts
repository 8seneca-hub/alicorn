import { z } from 'zod'
import { ExecutionStrategySchema, type ExecutionStrategy } from './ledger.js'

/**
 * A task: the unit of work, and the thing the board is a board of.
 *
 * PRODUCT-ARCHITECTURE §2 — "THE UNIT OF WORK. Replaces the worktree as the thing you open, name,
 * assign and finish." The data model already went task-first: `alicorn_task_strategy` and
 * `alicorn_task_worktrees` (SCHEMA_VERSION 39) are both keyed by a task id. What was missing was
 * the task itself, so the board had nothing to render but worktrees — which is one thing a task
 * might need, not the task.
 *
 * What is deliberately *not* here: the `(repo, branch, worktree)` tuples a task binds. Those stay
 * in the client's orchestration SQLite because execution is on the client and a worktree path
 * names nothing on another host. This row is the ticket; the tuples are how it is being worked on.
 */

/**
 * Board columns are Orca's workspace statuses (`src/shared/workspace-status-defaults.ts`), which
 * is also what `WorkflowStage.columnId` already points at. Stored as an opaque id rather than an
 * enum so a project that renames or adds a column does not need a migration here.
 */
export const TaskColumnSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'column must be a lowercase workspace-status id')

/**
 * The column that means finished. Orca's last default workspace status — the only answer available
 * until a project can author its own board columns, at which point this becomes a project field
 * rather than a constant.
 */
export const TASK_DONE_COLUMN = 'completed'

/**
 * Where a task came from, when it was not typed here.
 *
 * `provider` uses the desktop's own `TaskProvider` vocabulary so an imported task reads the same
 * as a linked workspace does. `ref` is the human id (`ALC-11`) and is what dedupe keys on: importing
 * the same board twice must not create the ticket twice, and a provider's internal uuid is not what
 * a person would recognise in the list.
 */
export const TASK_SOURCE_PROVIDERS = ['github', 'gitlab', 'linear', 'jira', 'plane'] as const
export type TaskSourceProvider = (typeof TASK_SOURCE_PROVIDERS)[number]

export const TaskSourceSchema = z.object({
  provider: z.enum(TASK_SOURCE_PROVIDERS),
  ref: z.string().trim().min(1).max(120),
  url: z.string().trim().max(2000).nullable().default(null)
})

export type TaskSource = z.infer<typeof TaskSourceSchema>

export const TaskInputSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  /** The brief: what the agent cannot read off the repo. Empty is allowed and common. */
  context: z.string().max(20_000).default(''),
  column: TaskColumnSchema.default('todo'),
  /**
   * `single` is the default and stays the default — multi-agent is a trade, not an upgrade, and
   * anything that makes `orchestrated` the default path is wrong (CLAUDE.md).
   */
  executionStrategy: ExecutionStrategySchema.default('single'),
  /**
   * Which workflow this task runs under, of the several a project may hold — an investigation is
   * not a feature delivery, and pretending one shape fits both is what made the rail noise.
   *
   * **Null is a real answer**, not an omission: no workflow, no stages, no hand-off — a raw session
   * on a brief. That is the majority of work and it stays the cheapest thing to ask for.
   */
  workflowId: z.string().trim().min(1).max(200).nullable().default(null),
  /** A stage of that workflow. Null when there is no workflow, or before it has started. */
  stageKey: z.string().trim().min(1).max(120).nullable().default(null),
  /**
   * Which model the session runs on — a catalog id (`opus`, `sonnet`, `gpt-5.5`), not a wire name.
   *
   * On the task rather than the member because it is the *work* that is hard or cheap, not the
   * role: the same reviewer reads a one-line fix and a schema migration. Null takes the backend's
   * own default, which is what most tickets want.
   */
  model: z.string().trim().min(1).max(120).nullable().default(null),
  /** Org members bound to this task. Order is not meaningful; the set is. */
  memberIds: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  /** Null for a task typed here; set for one imported from a PM tool. */
  source: TaskSourceSchema.nullable().default(null)
})

export type TaskInput = z.infer<typeof TaskInputSchema>

/** Every field optional: the board moves one column, the composer edits one title. */
export const TaskPatchSchema = TaskInputSchema.partial().omit({ projectId: true })

export type TaskPatch = z.infer<typeof TaskPatchSchema>

export type Task = {
  id: string
  tenantId: string
  projectId: string
  /**
   * Per-project sequence. The displayed id is `${project.key}-${number}` — PAY-142 — composed at
   * the edge rather than stored, so renaming a project's key renames its task ids with it.
   */
  number: number
  title: string
  context: string
  column: string
  executionStrategy: ExecutionStrategy
  workflowId: string | null
  stageKey: string | null
  model: string | null
  memberIds: string[]
  source: TaskSource | null
  createdBy: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

/** `PAY-142`. The one place the display id is composed, so every surface spells it the same. */
export function formatTaskRef(projectKey: string, number: number): string {
  return `${projectKey}-${number}`
}
