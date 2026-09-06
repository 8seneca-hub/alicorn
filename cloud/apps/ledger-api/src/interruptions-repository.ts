import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { InterruptionInput, InterruptionsReport, InterruptionsReportFilters } from '@alicorn-cloud/control-plane-contract'

export function insertInterruption(
  pool: pg.Pool,
  tenantId: string,
  input: InterruptionInput
): Promise<{ id: string; duplicate: boolean }> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO step_interruptions (tenant_id, run_id, task_id, dispatch_id, kind, source_id, resolved_by, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, kind, source_id) DO NOTHING
       RETURNING id`,
      [tenantId, input.runId, input.taskId, input.dispatchId, input.kind, input.sourceId, input.resolvedBy, input.occurredAt]
    )
    const row = rows[0]
    if (row) return { id: row.id, duplicate: false }
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM step_interruptions WHERE tenant_id = $1 AND kind = $2 AND source_id = $3`,
      [tenantId, input.kind, input.sourceId]
    )
    return { id: existing.rows[0]!.id, duplicate: true }
  })
}

// Why: same stageKey/projectId/memberId/since/until filters apply to both queries, always against
// step_outcomes (`o`) — the join brings step_interruptions into that scope, never the reverse.
function outcomeFilterClause(filters: InterruptionsReportFilters, startIndex: number): { clause: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = startIndex
  if (filters.stageKey) { conditions.push(`o.stage_key = $${i++}`); params.push(filters.stageKey) }
  if (filters.projectId) { conditions.push(`o.project_id = $${i++}`); params.push(filters.projectId) }
  if (filters.memberId) { conditions.push(`o.member_id = $${i++}`); params.push(filters.memberId) }
  if (filters.since) { conditions.push(`o.created_at >= $${i++}`); params.push(filters.since) }
  if (filters.until) { conditions.push(`o.created_at <= $${i++}`); params.push(filters.until) }
  return { clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

const INTERRUPTIONS_JOIN = `FROM step_interruptions i JOIN step_outcomes o
  ON o.tenant_id = i.tenant_id AND o.task_id = i.task_id AND o.dispatch_id = i.dispatch_id`

export function getInterruptionsReport(
  pool: pg.Pool,
  tenantId: string,
  filters: InterruptionsReportFilters
): Promise<InterruptionsReport> {
  return withTenant(pool, tenantId, async (client) => {
    const { clause, params } = outcomeFilterClause(filters, 1)

    const { rows: completedRows } = await client.query<{ n: number }>(
      `SELECT COUNT(DISTINCT o.task_id)::int AS n FROM step_outcomes o ${clause}`,
      params
    )
    const completedTasks = completedRows[0]?.n ?? 0

    const { rows: totalRows } = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n ${INTERRUPTIONS_JOIN} ${clause}`,
      params
    )
    const interruptions = totalRows[0]?.n ?? 0

    const { rows: kindRows } = await client.query<{ kind: string; n: number }>(
      `SELECT i.kind, COUNT(*)::int AS n ${INTERRUPTIONS_JOIN} ${clause} GROUP BY i.kind`,
      params
    )
    const byKind: Record<string, number> = {}
    for (const row of kindRows) byKind[row.kind] = row.n

    const { rows: stageCompletedRows } = await client.query<{ stage_key: string; n: number }>(
      `SELECT o.stage_key, COUNT(DISTINCT o.task_id)::int AS n FROM step_outcomes o ${clause} GROUP BY o.stage_key`,
      params
    )
    const { rows: stageInterruptionRows } = await client.query<{ stage_key: string; n: number }>(
      `SELECT o.stage_key, COUNT(*)::int AS n ${INTERRUPTIONS_JOIN} ${clause} GROUP BY o.stage_key`,
      params
    )
    const completedByStage = new Map(stageCompletedRows.map((r) => [r.stage_key, r.n]))
    const interruptionsByStage = new Map(stageInterruptionRows.map((r) => [r.stage_key, r.n]))
    const stageKeys = [...new Set([...completedByStage.keys(), ...interruptionsByStage.keys()])].sort()
    const byStage = stageKeys.map((stageKey) => {
      const stageCompleted = completedByStage.get(stageKey) ?? 0
      const stageInterruptions = interruptionsByStage.get(stageKey) ?? 0
      return {
        stageKey,
        completedTasks: stageCompleted,
        interruptions: stageInterruptions,
        // Why: no completed tasks for a stage means nothing to divide by — report 0, not NaN.
        perCompletedTask: stageCompleted === 0 ? 0 : stageInterruptions / stageCompleted
      }
    })

    return {
      filters,
      completedTasks,
      interruptions,
      // Why: same zero rule as per-stage — an empty denominator reports 0.
      perCompletedTask: completedTasks === 0 ? 0 : interruptions / completedTasks,
      byKind,
      byStage,
      excluded: ['permission_prompt']
    }
  })
}
