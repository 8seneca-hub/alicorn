import type { OrchestrationDb } from '../orchestration-db'
import type {
  TaskExecutionStrategy,
  TaskExecutionStrategyRow,
  TaskExecutionStrategySource
} from './alicorn-rows'

type AlicornTaskStrategyRow = {
  task_id: string
  strategy: TaskExecutionStrategy
  source: TaskExecutionStrategySource
  escalation_offered_at: string | null
  escalation_accepted_at: string | null
  updated_at: string
}

export function getTaskExecutionStrategy(
  this: OrchestrationDb,
  taskId: string
): TaskExecutionStrategyRow {
  const row = this.db
    .prepare('SELECT * FROM alicorn_task_strategy WHERE task_id = ?')
    .get(taskId) as AlicornTaskStrategyRow | undefined
  if (!row) {
    return {
      strategy: 'single',
      source: 'default',
      escalationOfferedAt: null,
      escalationAcceptedAt: null
    }
  }
  return {
    strategy: row.strategy,
    source: row.source,
    escalationOfferedAt: row.escalation_offered_at,
    escalationAcceptedAt: row.escalation_accepted_at
  }
}

export function setTaskExecutionStrategy(
  this: OrchestrationDb,
  taskId: string,
  strategy: TaskExecutionStrategy,
  source: 'user' | 'escalation'
): void {
  this.db
    .prepare(
      `INSERT INTO alicorn_task_strategy (task_id, strategy, source, escalation_accepted_at, updated_at)
       VALUES (?, ?, ?, CASE WHEN ? = 'escalation' THEN datetime('now') ELSE NULL END, datetime('now'))
       ON CONFLICT(task_id) DO UPDATE SET
         strategy = excluded.strategy,
         source = excluded.source,
         escalation_accepted_at = CASE WHEN ? = 'escalation' THEN datetime('now')
           ELSE alicorn_task_strategy.escalation_accepted_at END,
         updated_at = datetime('now')`
    )
    .run(taskId, strategy, source, source, source)
}

// Why: upsert keeping strategy 'single' on first insert; returns false when already offered so the watcher offers once.
export function markEscalationOffered(this: OrchestrationDb, taskId: string): boolean {
  const result = this.db
    .prepare(
      `INSERT INTO alicorn_task_strategy (task_id, strategy, source, escalation_offered_at, updated_at)
       VALUES (?, 'single', 'default', datetime('now'), datetime('now'))
       ON CONFLICT(task_id) DO UPDATE SET
         escalation_offered_at = datetime('now'),
         updated_at = datetime('now')
       WHERE alicorn_task_strategy.escalation_offered_at IS NULL`
    )
    .run(taskId)
  return result.changes > 0
}

export type TaskStrategyMethods = {
  getTaskExecutionStrategy: typeof getTaskExecutionStrategy
  setTaskExecutionStrategy: typeof setTaskExecutionStrategy
  markEscalationOffered: typeof markEscalationOffered
}

export function attachTaskStrategyMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    getTaskExecutionStrategy,
    setTaskExecutionStrategy,
    markEscalationOffered
  })
}
