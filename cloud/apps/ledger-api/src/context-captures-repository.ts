import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { ContextCaptureInput, ContextCaptureRead } from '@alicorn-cloud/control-plane-contract'

interface ContextCaptureRow {
  dispatch_id: string
  created_at: Date
  prompt_bytes: number
  prompt: string | null
  prompt_path: string | null
  context_slice: unknown
}

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

// Scoped by run, not repo/branch: a run is the reading order an inspector opens.
// dispatch_id as tiebreaker keeps the order total when created_at ties.
// Why withTenant here and not at the caller: tenant scoping is a property of the
// function, so a route cannot forget it — every sibling repository reads the same way.
export function listContextCapturesForRun(
  pool: pg.Pool,
  tenantId: string,
  runId: string
): Promise<ContextCaptureRead[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<ContextCaptureRow>(
      `SELECT dispatch_id, created_at, prompt_bytes, prompt, prompt_path, context_slice
       FROM context_captures WHERE run_id = $1 ORDER BY created_at ASC, dispatch_id ASC`,
      [runId]
    )
    return rows.map((r) => ({
      dispatchId: r.dispatch_id,
      createdAt: r.created_at.toISOString(),
      promptBytes: r.prompt_bytes,
      prompt: r.prompt,
      promptPath: r.prompt_path,
      contextSlice: r.context_slice
    }))
  })
}
