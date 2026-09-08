import type { OrchestrationDb } from '../orchestration-db'
import type { DispatchVerificationRow, VerificationStatus } from './alicorn-rows'

type AlicornDispatchVerificationRow = {
  dispatch_id: string
  task_id: string
  kind: string
  name: string
  required: number
  status: VerificationStatus
  detail: string | null
  recorded_at: string
}

function toRow(row: AlicornDispatchVerificationRow): DispatchVerificationRow {
  return {
    dispatchId: row.dispatch_id,
    taskId: row.task_id,
    kind: row.kind,
    name: row.name,
    required: row.required === 1,
    status: row.status,
    detail: row.detail,
    recordedAt: row.recorded_at
  }
}

/** Last writer wins on (dispatch, kind, name) — a re-run's verdict replaces the one it re-ran. */
export function recordDispatchVerification(
  this: OrchestrationDb,
  row: {
    dispatchId: string
    taskId: string
    kind: string
    name: string
    required: boolean
    status: VerificationStatus
    detail?: Record<string, unknown> | null
  }
): void {
  this.db
    .prepare(
      `INSERT INTO alicorn_dispatch_verifications
         (dispatch_id, task_id, kind, name, required, status, detail, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(dispatch_id, kind, name) DO UPDATE SET
         task_id = excluded.task_id,
         required = excluded.required,
         status = excluded.status,
         detail = excluded.detail,
         recorded_at = excluded.recorded_at`
    )
    .run(
      row.dispatchId,
      row.taskId,
      row.kind,
      row.name,
      row.required ? 1 : 0,
      row.status,
      row.detail ? JSON.stringify(row.detail) : null
    )
}

export function listTaskVerifications(
  this: OrchestrationDb,
  taskId: string
): DispatchVerificationRow[] {
  const rows = this.db
    .prepare(
      `SELECT * FROM alicorn_dispatch_verifications WHERE task_id = ? ORDER BY recorded_at, name`
    )
    .all(taskId) as AlicornDispatchVerificationRow[]
  return rows.map(toRow)
}

export type DispatchVerificationMethods = {
  recordDispatchVerification: typeof recordDispatchVerification
  listTaskVerifications: typeof listTaskVerifications
}

export function attachDispatchVerificationMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    recordDispatchVerification,
    listTaskVerifications
  })
}
