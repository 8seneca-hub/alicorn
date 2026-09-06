import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { ProvenanceReport, RunCost } from '@alicorn-cloud/control-plane-contract'
import { toStepOutcomeRecord } from './step-outcomes-repository.js'
import { toStepVerificationRecord } from './step-verifications-repository.js'

export function getProvenance(
  pool: pg.Pool,
  tenantId: string,
  input: { repoId: string; branch: string }
): Promise<ProvenanceReport> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows: outcomeRows } = await client.query(
      `SELECT * FROM step_outcomes WHERE repo_id = $1 AND branch = $2 ORDER BY created_at, id`,
      [input.repoId, input.branch]
    )
    const outcomes = outcomeRows.map(toStepOutcomeRecord)
    const dispatchIds = outcomes.map((o) => o.dispatchId)

    const { rows: verificationRows } = await client.query(
      `SELECT * FROM step_verifications WHERE dispatch_id = ANY($1) ORDER BY created_at`,
      [dispatchIds]
    )
    const verifications = verificationRows.map(toStepVerificationRecord)

    const { rows: captureRows } = await client.query<{ dispatch_id: string; prompt_bytes: number; created_at: Date }>(
      `SELECT dispatch_id, prompt_bytes, created_at FROM context_captures WHERE dispatch_id = ANY($1) ORDER BY created_at`,
      [dispatchIds]
    )
    const contextCaptures = captureRows.map((r) => ({
      dispatchId: r.dispatch_id,
      promptBytes: r.prompt_bytes,
      createdAt: r.created_at.toISOString()
    }))

    const spendCents = outcomes.reduce((sum, o) => sum + (o.spendCents ?? 0), 0)
    const tasks = new Set(outcomes.map((o) => o.taskId)).size
    const dispatches = new Set(outcomes.map((o) => o.dispatchId)).size
    // Why: the ledger has no view of org policy — it only reports whether any outcome bypassed
    // review, and the desktop renders "enforced" vs "bypassed" from that.
    const bypassed = outcomes.some((o) => o.reviewBackendBypass)

    return {
      repoId: input.repoId,
      branch: input.branch,
      outcomes,
      verifications,
      contextCaptures,
      totals: { spendCents, tasks, dispatches },
      reviewBackend: { bypassed, enforced: !bypassed }
    }
  })
}

export function getRunCost(pool: pg.Pool, tenantId: string, runId: string): Promise<RunCost> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ dispatch_id: string; task_id: string; backend: string; spend_cents: number | null }>(
      `SELECT dispatch_id, task_id, backend, spend_cents FROM step_outcomes WHERE run_id = $1 ORDER BY created_at`,
      [runId]
    )
    const byDispatch = rows.map((r) => ({
      dispatchId: r.dispatch_id,
      taskId: r.task_id,
      backend: r.backend,
      spendCents: r.spend_cents
    }))
    const totalSpendCents = rows.reduce((sum, r) => sum + (r.spend_cents ?? 0), 0)
    return { runId, totalSpendCents, byDispatch }
  })
}
