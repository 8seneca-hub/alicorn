import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { ContextCaptureInput } from '@alicorn-cloud/control-plane-contract'

export function insertContextCapture(
  pool: pg.Pool,
  tenantId: string,
  input: ContextCaptureInput
): Promise<{ id: string; duplicate: boolean }> {
  return withTenant(pool, tenantId, async (client) => {
    const promptBytes = Buffer.byteLength(input.prompt ?? '', 'utf8')
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO context_captures (tenant_id, run_id, task_id, dispatch_id, prompt, prompt_path, prompt_bytes, context_slice)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (tenant_id, dispatch_id) DO NOTHING
       RETURNING id`,
      [
        tenantId, input.runId, input.taskId, input.dispatchId,
        input.prompt ?? null, input.promptPath ?? null, promptBytes, JSON.stringify(input.contextSlice)
      ]
    )
    const row = rows[0]
    if (row) return { id: row.id, duplicate: false }
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM context_captures WHERE tenant_id = $1 AND dispatch_id = $2`,
      [tenantId, input.dispatchId]
    )
    return { id: existing.rows[0]!.id, duplicate: true }
  })
}
