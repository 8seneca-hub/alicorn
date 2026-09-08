import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type {
  CompletedTaskDefinition,
  InterruptionInput,
  InterruptionsReport,
  InterruptionsReportFilters
} from '@alicorn-cloud/control-plane-contract'

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

// Why: the same filters apply to every query, always against step_outcomes (`o`) — the join brings
// step_interruptions into that scope, never the reverse.
function outcomeFilterClause(filters: InterruptionsReportFilters, startIndex: number): { clause: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = startIndex
  if (filters.stageKey) { conditions.push(`o.stage_key = $${i++}`); params.push(filters.stageKey) }
  if (filters.projectId) { conditions.push(`o.project_id = $${i++}`); params.push(filters.projectId) }
  if (filters.memberId) { conditions.push(`o.member_id = $${i++}`); params.push(filters.memberId) }
  if (filters.runId) { conditions.push(`o.run_id = $${i++}`); params.push(filters.runId) }
  if (filters.executionStrategy) { conditions.push(`o.execution_strategy = $${i++}`); params.push(filters.executionStrategy) }
  if (filters.since) { conditions.push(`o.created_at >= $${i++}`); params.push(filters.since) }
  if (filters.until) { conditions.push(`o.created_at <= $${i++}`); params.push(filters.until) }
  return { clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

const INTERRUPTIONS_JOIN = `FROM step_interruptions i JOIN step_outcomes o
  ON o.tenant_id = i.tenant_id AND o.task_id = i.task_id AND o.dispatch_id = i.dispatch_id`

function withCondition(clause: string, condition: string): string {
  return clause ? `${clause} AND ${condition}` : `WHERE ${condition}`
}

// ── The definition seam (LG5) ────────────────────────────────────────────────────────────────────
// Everything downstream counts (task_id, stage_key) pairs; only these two functions know what
// "completed" and "touched" mean, and only `completedTaskPairsSql` is up for redefinition.
//
// Today it is (a) *any successful step* — unambiguous, and it needs nothing that does not exist yet.
// Swapping to (b) *terminal stage succeeded* or (c) *no failed step outstanding* (latest outcome per
// stage all succeeded) means replacing `completedTaskPairsSql` and `COMPLETED_TASK_DEFINITION`, and
// nothing else in this file or above it. Both candidates are expressible as a query over the same
// filtered `step_outcomes` rows yielding the same two columns, so the seam holds:
//   (b) join the pairs against the workflow template's terminal stage (WF1) instead of `outcome`;
//   (c) keep, per (task_id, stage_key), the row with the greatest created_at and require it to have
//       succeeded — a DISTINCT ON (o.task_id, o.stage_key) … ORDER BY o.created_at DESC subquery.
export const COMPLETED_TASK_DEFINITION: CompletedTaskDefinition = 'any_successful_step'

function completedTaskPairsSql(clause: string): string {
  return `SELECT DISTINCT o.task_id, o.stage_key FROM step_outcomes o ${withCondition(clause, `o.outcome = 'succeeded'`)}`
}

// The loose denominator the report shipped with: a task is counted for being touched at all.
function touchedTaskPairsSql(clause: string): string {
  return `SELECT DISTINCT o.task_id, o.stage_key FROM step_outcomes o ${clause}`
}
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// Why: no completed tasks means nothing to divide by — report 0, not NaN.
function perTask(interruptions: number, tasks: number): number {
  return tasks === 0 ? 0 : interruptions / tasks
}

export function getInterruptionsReport(
  pool: pg.Pool,
  tenantId: string,
  filters: InterruptionsReportFilters
): Promise<InterruptionsReport> {
  return withTenant(pool, tenantId, async (client) => {
    const { clause, params } = outcomeFilterClause(filters, 1)

    const countTasks = async (pairsSql: string): Promise<number> => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT COUNT(DISTINCT pairs.task_id)::int AS n FROM (${pairsSql}) pairs`,
        params
      )
      return rows[0]?.n ?? 0
    }
    const countTasksByStage = async (pairsSql: string): Promise<Map<string, number>> => {
      const { rows } = await client.query<{ stage_key: string; n: number }>(
        `SELECT pairs.stage_key, COUNT(DISTINCT pairs.task_id)::int AS n FROM (${pairsSql}) pairs GROUP BY pairs.stage_key`,
        params
      )
      return new Map(rows.map((r) => [r.stage_key, r.n]))
    }

    const completedTasks = await countTasks(completedTaskPairsSql(clause))
    const tasksTouched = await countTasks(touchedTaskPairsSql(clause))

    // Why DISTINCT i.id, not COUNT(*): today's join can't fan out, but v1.5 stages make a task
    // carry more than one dispatch plausible, and a fanned-out COUNT(*) would silently inflate
    // the north-star metric (item 14).
    const { rows: totalRows } = await client.query<{ n: number }>(
      `SELECT COUNT(DISTINCT i.id)::int AS n ${INTERRUPTIONS_JOIN} ${clause}`,
      params
    )
    const interruptions = totalRows[0]?.n ?? 0

    const { rows: kindRows } = await client.query<{ kind: string; n: number }>(
      `SELECT i.kind, COUNT(DISTINCT i.id)::int AS n ${INTERRUPTIONS_JOIN} ${clause} GROUP BY i.kind`,
      params
    )
    const byKind: Record<string, number> = {}
    for (const row of kindRows) byKind[row.kind] = row.n

    const completedByStage = await countTasksByStage(completedTaskPairsSql(clause))
    const touchedByStage = await countTasksByStage(touchedTaskPairsSql(clause))
    const { rows: stageInterruptionRows } = await client.query<{ stage_key: string; n: number }>(
      `SELECT o.stage_key, COUNT(DISTINCT i.id)::int AS n ${INTERRUPTIONS_JOIN} ${clause} GROUP BY o.stage_key`,
      params
    )
    const interruptionsByStage = new Map(stageInterruptionRows.map((r) => [r.stage_key, r.n]))
    // Why touched, not completed: a stage whose every step failed still has to appear, or the
    // failing stage disappears from the report exactly when it matters most.
    const stageKeys = [...new Set([...touchedByStage.keys(), ...interruptionsByStage.keys()])].sort()
    const byStage = stageKeys.map((stageKey) => {
      const stageCompleted = completedByStage.get(stageKey) ?? 0
      const stageTouched = touchedByStage.get(stageKey) ?? 0
      const stageInterruptions = interruptionsByStage.get(stageKey) ?? 0
      return {
        stageKey,
        completedTasks: stageCompleted,
        tasksTouched: stageTouched,
        interruptions: stageInterruptions,
        perCompletedTask: perTask(stageInterruptions, stageCompleted),
        perTaskTouched: perTask(stageInterruptions, stageTouched)
      }
    })

    return {
      filters,
      completedTaskDefinition: COMPLETED_TASK_DEFINITION,
      completedTasks,
      tasksTouched,
      interruptions,
      perCompletedTask: perTask(interruptions, completedTasks),
      perTaskTouched: perTask(interruptions, tasksTouched),
      byKind,
      byStage,
      excluded: ['permission_prompt']
    }
  })
}
