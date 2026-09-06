import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RunRow, TaskRow } from '../../orchestration/types'
import type { TaskExecutionStrategy } from '../../orchestration/db/alicorn/alicorn-rows'
import { withExecutionStrategy } from './orchestration-task-execution-strategy'

export type CreateTaskInRunInput = {
  spec: string
  taskTitle?: string
  displayName?: string
  /** Already parsed. Flag parsing stays a CLI/RPC concern. */
  deps?: string[]
  parent?: string
  executionStrategy?: TaskExecutionStrategy
  /** Absent for a caller with no terminal, such as board automation's system Run. */
  callerTerminalHandle?: string
}

/**
 * Creates a task inside an already-resolved Run.
 *
 * Extracted from the `orchestration.taskCreate` handler so callers inside the main process — board
 * automation dispatching a column transition — can create a task without going through the RPC
 * dispatcher and its caller-authority checks, which a system Run has no way to satisfy.
 */
export function createTaskInRun(
  runtime: OrcaRuntimeService,
  run: RunRow,
  input: CreateTaskInRunInput
): TaskRow & { executionStrategy: TaskExecutionStrategy } {
  const db = runtime.getOrchestrationDb()
  const creatorAuthority = input.callerTerminalHandle
    ? runtime.getOrchestrationDispatchAuthority(input.callerTerminalHandle)
    : null
  const task = db.createTask({
    spec: input.spec,
    taskTitle: input.taskTitle,
    displayName: input.displayName,
    deps: input.deps,
    parentId: input.parent,
    createdByTerminalHandle: input.callerTerminalHandle,
    ...(creatorAuthority?.paneKey && creatorAuthority.processIncarnation
      ? {
          createdByPaneKey: creatorAuthority.paneKey,
          createdByProcessIncarnation: creatorAuthority.processIncarnation,
          createdByRunGeneration: run.consumer_generation
        }
      : {}),
    runId: run.id
  })
  if (input.executionStrategy) {
    db.setTaskExecutionStrategy(task.id, input.executionStrategy, 'user')
  }
  return withExecutionStrategy(db, task)
}
