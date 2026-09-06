import type { OrchestrationDb } from '../orchestration-db'

type SettledDispatchForCorrectionsQueryRow = {
  dispatch_id: string
  task_id: string
  dispatched_at: string | null
  completed_at: string
  worktree_id: string | null
  step_outcome_payload: string | null
}

export type SettledDispatchForCorrections = {
  dispatchId: string
  taskId: string
  dispatchedAt: string | null
  completedAt: string
  worktreeId: string | null
  filesModified: string[]
}

// Why the ledger_outbox join, not tasks.result: tasks.result is last-write-wins across a
// task's dispatches, so a reopened task's earlier dispatch would read the newer dispatch's
// files. The step_outcome outbox row is dedupe-keyed per dispatch and never overwritten.
function filesModifiedFromStepOutcomeRow(payloadJson: string | null): string[] {
  if (!payloadJson) {
    return []
  }
  try {
    const outboxPayload = JSON.parse(payloadJson) as { result?: string }
    if (!outboxPayload.result) {
      return []
    }
    const parsedResult = JSON.parse(outboxPayload.result) as { filesModified?: string[] }
    return parsedResult.filesModified ?? []
  } catch {
    return []
  }
}

/** Settled (completed or failed) dispatches with their worktree, for the corrections sweep. */
export function listSettledDispatchesForCorrections(
  this: OrchestrationDb,
  sinceUtc: string
): SettledDispatchForCorrections[] {
  const rows = this.db
    .prepare(
      `SELECT dc.id AS dispatch_id, dc.task_id, dc.dispatched_at, dc.completed_at,
              wd.worktree_id,
              lo.payload AS step_outcome_payload
       FROM dispatch_contexts dc
       JOIN worker_dispatches wd ON wd.dispatch_id = dc.id
       LEFT JOIN ledger_outbox lo
         ON lo.kind = 'step_outcome' AND lo.dedupe_key = 'step_outcome:' || dc.id
       WHERE dc.status IN ('completed', 'failed') AND dc.completed_at >= ?
       ORDER BY dc.completed_at ASC`
    )
    .all(sinceUtc) as SettledDispatchForCorrectionsQueryRow[]
  return rows.map((row) => ({
    dispatchId: row.dispatch_id,
    taskId: row.task_id,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at,
    worktreeId: row.worktree_id,
    filesModified: filesModifiedFromStepOutcomeRow(row.step_outcome_payload)
  }))
}

export type SettledDispatchCorrectionsMethods = {
  listSettledDispatchesForCorrections: typeof listSettledDispatchesForCorrections
}

export function attachSettledDispatchCorrectionsMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    listSettledDispatchesForCorrections
  })
}
