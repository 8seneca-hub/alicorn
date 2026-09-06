import type pg from 'pg'
import type { z } from 'zod'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import { StepVerificationRecordSchema } from '@alicorn-cloud/control-plane-contract'
import type { StepVerificationInput } from '@alicorn-cloud/control-plane-contract'

// Why: the contract only exports the schema for this record, not a standalone type.
type StepVerificationRecord = z.infer<typeof StepVerificationRecordSchema>

export type StepVerificationRow = {
  id: string
  run_id: string
  task_id: string
  dispatch_id: string
  kind: string
  name: string
  required: boolean
  status: string
  detail: Record<string, unknown>
  created_at: Date
}

export function toStepVerificationRecord(row: StepVerificationRow): StepVerificationRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    kind: row.kind as StepVerificationRecord['kind'],
    name: row.name,
    required: row.required,
    status: row.status as StepVerificationRecord['status'],
    detail: row.detail,
    createdAt: row.created_at.toISOString()
  }
}

export function insertStepVerification(
  pool: pg.Pool,
  tenantId: string,
  input: StepVerificationInput
): Promise<{ id: string; duplicate: boolean }> {
  return withTenant(pool, tenantId, async (client) => {
    // Why: a re-run check may legitimately change status; that's not a ledger *outcome*, so
    // conflicts update in place instead of being rejected — (xmax = 0) tells fresh insert from update.
    const { rows } = await client.query<{ id: string; inserted: boolean }>(
      `INSERT INTO step_verifications (tenant_id, run_id, task_id, dispatch_id, kind, name, required, status, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (tenant_id, dispatch_id, kind, name) DO UPDATE SET
         status = EXCLUDED.status, detail = EXCLUDED.detail, required = EXCLUDED.required
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, input.runId, input.taskId, input.dispatchId, input.kind, input.name, input.required, input.status, JSON.stringify(input.detail)]
    )
    const row = rows[0]!
    return { id: row.id, duplicate: !row.inserted }
  })
}
