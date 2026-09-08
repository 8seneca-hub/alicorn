import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import {
  CONTEXT_CAPTURE_LIST_LIMIT,
  type ContextCaptureInput,
  type ContextCaptureRead
} from '@alicorn-cloud/control-plane-contract'

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
// Why the +1 and the flag: fetching one past the cap is how we know the run had more without a
// second count query, and reporting it keeps a truncated inspector from looking like a short run.
export function listContextCapturesForRun(
  pool: pg.Pool,
  tenantId: string,
  runId: string
): Promise<{ captures: ContextCaptureRead[]; truncated: boolean }> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<ContextCaptureRow>(
      `SELECT dispatch_id, created_at, prompt_bytes, prompt, prompt_path, context_slice
       FROM context_captures WHERE run_id = $1 ORDER BY created_at ASC, dispatch_id ASC
       LIMIT $2`,
      [runId, CONTEXT_CAPTURE_LIST_LIMIT + 1]
    )
    const truncated = rows.length > CONTEXT_CAPTURE_LIST_LIMIT
    return {
      captures: rows.slice(0, CONTEXT_CAPTURE_LIST_LIMIT).map((r) => ({
        dispatchId: r.dispatch_id,
        createdAt: r.created_at.toISOString(),
        promptBytes: r.prompt_bytes,
        prompt: r.prompt,
        promptPath: r.prompt_path,
        contextSlice: r.context_slice
      })),
      truncated
    }
  })
}

// One capture by id. Two reasons it is not the list filtered down: the inspector's list read
// discards prompt bodies, so opening one would otherwise re-read every prompt in the run, and a
// capture beyond CONTEXT_CAPTURE_LIST_LIMIT never appears in the list at all.
// Keyed by run *and* dispatch even though dispatch_id is unique per tenant: the caller holds both,
// and matching the list route's scope keeps a mistyped run id a 404 rather than a foreign capture.
export function getContextCaptureForDispatch(
  pool: pg.Pool,
  tenantId: string,
  runId: string,
  dispatchId: string
): Promise<ContextCaptureRead | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<ContextCaptureRow>(
      `SELECT dispatch_id, created_at, prompt_bytes, prompt, prompt_path, context_slice
       FROM context_captures WHERE run_id = $1 AND dispatch_id = $2`,
      [runId, dispatchId]
    )
    const row = rows[0]
    if (!row) return null
    return {
      dispatchId: row.dispatch_id,
      createdAt: row.created_at.toISOString(),
      promptBytes: row.prompt_bytes,
      prompt: row.prompt,
      promptPath: row.prompt_path,
      contextSlice: row.context_slice
    }
  })
}
