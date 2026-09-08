import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { GateAgreementPatch, HumanVerdictPatch, SpendPatch, StepOutcomeInput, StepOutcomeRecord } from '@alicorn-cloud/control-plane-contract'
import { upsertMemberStageStats } from './member-stage-stats.js'

export type StepOutcomeRow = {
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
  gate_id: string | null
  policy_recommendation: string | null
  policy_recommendation_reason: string | null
  human_gate_decision: string | null
  agreed_with_policy: boolean | null
  recommendation_shown: boolean | null
  human_verdict: string | null
  amended_after_ms: number | null
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
    gateId: row.gate_id,
    policyRecommendation: row.policy_recommendation as StepOutcomeRecord['policyRecommendation'],
    policyRecommendationReason: row.policy_recommendation_reason,
    humanGateDecision: row.human_gate_decision as StepOutcomeRecord['humanGateDecision'],
    agreedWithPolicy: row.agreed_with_policy,
    recommendationShown: row.recommendation_shown,
    humanVerdict: row.human_verdict as StepOutcomeRecord['humanVerdict'],
    amendedAfterMs: row.amended_after_ms,
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

// Why: append-only (R3) — a verdict is written once (WHERE human_verdict IS NULL); a second,
// different signal is a new event for the caller to log, never an overwrite.
export function patchStepOutcomeHumanVerdict(
  pool: pg.Pool,
  tenantId: string,
  id: string,
  patch: HumanVerdictPatch
): Promise<'patched' | 'not_found' | 'already_set'> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ member_id: string | null; stage_key: string; project_id: string | null }>(
      `UPDATE step_outcomes SET human_verdict = $1, amended_after_ms = $2
       WHERE id = $3 AND human_verdict IS NULL
       RETURNING member_id, stage_key, project_id`,
      [patch.humanVerdict, patch.amendedAfterMs, id]
    )
    const row = rows[0]
    if (!row) {
      const existing = await client.query(`SELECT id FROM step_outcomes WHERE id = $1`, [id])
      return existing.rows[0] ? 'already_set' : 'not_found'
    }
    // Why (LC-R3): only a correction (amended/rejected) feeds demotion per ARCHITECTURE §7 —
    // an accepted verdict leaves last_amended_at untouched.
    if (row.member_id && (patch.humanVerdict === 'amended' || patch.humanVerdict === 'rejected')) {
      await client.query(
        `UPDATE member_stage_stats SET last_amended_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND member_id = $2 AND stage_key = $3 AND project_id = $4`,
        [tenantId, row.member_id, row.stage_key, row.project_id ?? '']
      )
    }
    return 'patched'
  })
}

/**
 * GP3: records what the policy would have decided, what the human decided about the gate, and
 * whether they matched. Write-once like the human verdict — a gate resolves once, so a second
 * patch is a new event to log, never an overwrite of the first answer.
 *
 * `agreed_with_policy` is computed here rather than taken from the body: agreement is the
 * measurement, and a measurement a client can assert independently of its own inputs is not one.
 */
export function patchStepOutcomeGateAgreement(
  pool: pg.Pool,
  tenantId: string,
  id: string,
  patch: GateAgreementPatch
): Promise<'patched' | 'not_found' | 'already_set'> {
  return withTenant(pool, tenantId, async (client) => {
    const result = await client.query(
      `UPDATE step_outcomes
         SET gate_id = $1, policy_recommendation = $2, policy_recommendation_reason = $3,
             human_gate_decision = $4, agreed_with_policy = ($2 = $4), recommendation_shown = $5
       WHERE id = $6 AND human_gate_decision IS NULL`,
      [
        patch.gateId, patch.policyRecommendation, patch.policyRecommendationReason,
        patch.humanGateDecision, patch.recommendationShown, id
      ]
    )
    if ((result.rowCount ?? 0) > 0) {
      return 'patched'
    }
    const existing = await client.query(`SELECT id FROM step_outcomes WHERE id = $1`, [id])
    return existing.rows[0] ? 'already_set' : 'not_found'
  })
}
