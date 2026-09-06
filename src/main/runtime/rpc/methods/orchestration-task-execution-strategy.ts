import type { OrchestrationDb } from '../../orchestration/db'
import type { TaskExecutionStrategy } from '../../orchestration/db/alicorn/alicorn-rows'

// Why: the strategy lives in `alicorn_task_strategy`, not on the task row, so every task the RPC
// returns is projected through here rather than each handler remembering to join it. Absent row →
// `single`, which is what makes "no row" a safe default rather than a missing field.
export function withExecutionStrategy<T extends { id: string }>(
  db: OrchestrationDb,
  task: T
): T & { executionStrategy: TaskExecutionStrategy } {
  return { ...task, executionStrategy: db.getTaskExecutionStrategy(task.id).strategy }
}
