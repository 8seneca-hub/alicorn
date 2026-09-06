import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { SpendPatch, StepOutcomeInput, StepOutcomeRecord } from '@alicorn-cloud/control-plane-contract'
import { upsertMemberStageStats } from './member-stage-stats.js'

type StepOutcomeRow = {
  id: string
  tenant_id: string
  run_id: string
  task_id: string
  dispatch_id: string
  project_id: string | null
  repo_id: string | null
  worktree_id: string | null
  branch: string | null
  member_id: string | null
  backend: string
  stage_key: string
  execution_strategy: string
  outcome: string
  files_modified: string[]
  report_summary: string | null
  spend_cents: number | null
  usage: Record<string, unknown> | null
  gate_decision: string
  gate_reason: string
  review_backend_bypass: boolean
  escalation_offered: boolean
  escalation_accepted: boolean | null
  client_ts: Date | null
  created_at: Date
}

export function toStepOutcomeRecord(row: StepOutcomeRow): StepOutcomeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    runId: row.run_id,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    projectId: row.project_id ?? undefined,
    repoId: row.repo_id ?? undefined,
    worktreeId: row.worktree_id ?? undefined,
    branch: row.branch ?? undefined,
    memberId: row.member_id ?? undefined,
    backend: row.backend as StepOutcomeRecord['backend'],
    stageKey: row.stage_key,
    executionStrategy: row.execution_strategy as StepOutcomeRecord['executionStrategy'],
    outcome: row.outcome as StepOutcomeRecord['outcome'],
    filesModified: row.files_modified,
    reportSummary: row.report_summary ?? undefined,
    reviewBackendBypass: row.review_backend_bypass,
    escalationOffered: row.escalation_offered,
    // Why: escalation_accepted is a tri-state (null = not offered/decided) — never coerce to undefined.
    escalationAccepted: row.escalation_accepted,
    clientTs: row.client_ts ? row.client_ts.toISOString() : undefined,
    spendCents: row.spend_cents,
    usage: row.usage,
    gateDecision: row.gate_decision,
    gateReason: row.gate_reason,
    createdAt: row.created_at.toISOString()
  }
}

export function insertStepOutcome(
  pool: pg.Pool,
  tenantId: string,
  input: StepOutcomeInput
): Promise<{ id: string; duplicate: boolean }> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO step_outcomes (
         tenant_id, run_id, task_id, dispatch_id, project_id, repo_id, worktree_id, branch,
         member_id, backend, stage_key, execution_strategy, outcome, files_modified,
         report_summary, review_backend_bypass, escalation_offered, escalation_accepted, client_ts
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19)
       ON CONFLICT (tenant_id, run_id, task_id, stage_key, dispatch_id) DO NOTHING
       RETURNING id`,
      [
        tenantId, input.runId, input.taskId, input.dispatchId,
        input.projectId ?? null, input.repoId ?? null, input.worktreeId ?? null, input.branch ?? null,
        input.memberId ?? null, input.backend, input.stageKey, input.executionStrategy, input.outcome,
        JSON.stringify(input.filesModified), input.reportSummary ?? null,
        input.reviewBackendBypass, input.escalationOffered, input.escalationAccepted,
        input.clientTs ?? null
      ]
    )
    const row = rows[0]
    if (row) {
      // Why: stats are derived from step_outcomes and only meaningful for a tracked member (R6).
      if (input.memberId) {
        await upsertMemberStageStats(client, {
          tenantId,
          memberId: input.memberId,
          stageKey: input.stageKey,
          projectId: input.projectId ?? '',
          accepted: input.outcome === 'succeeded'
        })
      }
      return { id: row.id, duplicate: false }
    }
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM step_outcomes WHERE tenant_id = $1 AND run_id = $2 AND task_id = $3 AND stage_key = $4 AND dispatch_id = $5`,
      [tenantId, input.runId, input.taskId, input.stageKey, input.dispatchId]
    )
    return { id: existing.rows[0]!.id, duplicate: true }
  })
}

export function patchStepOutcomeSpend(pool: pg.Pool, tenantId: string, id: string, patch: SpendPatch): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const result = await client.query(
      `UPDATE step_outcomes SET spend_cents = $1, usage = $2::jsonb WHERE id = $3`,
      [patch.spendCents, patch.usage === null ? null : JSON.stringify(patch.usage), id]
    )
    return (result.rowCount ?? 0) > 0
  })
}
