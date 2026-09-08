import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import {
  AutonomyPolicySchema,
  type AutonomyPolicy,
  type AutonomyPolicyInput
} from '@alicorn-cloud/control-plane-contract'

type AutonomyPolicyRow = {
  project_id: string
  stage_key: string
  member_id: string | null
  mode: string
  min_runs: number
  min_accept_rate: string
  max_files: number | null
  max_spend_cents: number | null
  created_by: string
  expires_at: Date | null
  created_at: Date
}

const SELECT_COLUMNS = `project_id, stage_key, member_id, mode, min_runs, min_accept_rate,
  max_files, max_spend_cents, created_by, expires_at, created_at`

// NUMERIC comes back from pg as a string; parse through the schema so the wire shape is a number.
function toPolicy(row: AutonomyPolicyRow): AutonomyPolicy {
  return AutonomyPolicySchema.parse({
    projectId: row.project_id,
    stageKey: row.stage_key,
    memberId: row.member_id,
    mode: row.mode,
    minRuns: row.min_runs,
    minAcceptRate: Number(row.min_accept_rate),
    maxFiles: row.max_files,
    maxSpendCents: row.max_spend_cents,
    createdBy: row.created_by,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  })
}

/**
 * The policy that applies to one (project, stage, member): the member-specific row if there is
 * one, otherwise the stage wildcard. Null means the project has authored nothing and the caller
 * should apply the contract default — which is not the same as "the control plane is unreachable".
 */
export function getAutonomyPolicy(
  pool: pg.Pool,
  tenantId: string,
  key: { projectId: string; stageKey: string; memberId: string | null }
): Promise<AutonomyPolicy | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<AutonomyPolicyRow>(
      `SELECT ${SELECT_COLUMNS} FROM autonomy_policies
       WHERE project_id = $1 AND stage_key = $2 AND (member_id = $3 OR member_id IS NULL)
       ORDER BY member_id NULLS LAST
       LIMIT 1`,
      [key.projectId, key.stageKey, key.memberId]
    )
    const row = rows[0]
    return row ? toPolicy(row) : null
  })
}

export function listAutonomyPolicies(
  pool: pg.Pool,
  tenantId: string,
  projectId: string
): Promise<AutonomyPolicy[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<AutonomyPolicyRow>(
      `SELECT ${SELECT_COLUMNS} FROM autonomy_policies
       WHERE project_id = $1
       ORDER BY stage_key, member_id NULLS FIRST`,
      [projectId]
    )
    return rows.map(toPolicy)
  })
}

export function putAutonomyPolicy(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  createdBy: string,
  input: AutonomyPolicyInput
): Promise<AutonomyPolicy> {
  return withTenant(pool, tenantId, async (client) => {
    // Two statements rather than ON CONFLICT: the uniqueness lives in two partial indexes
    // (wildcard vs member-specific), and ON CONFLICT cannot name both.
    await client.query(
      `DELETE FROM autonomy_policies
       WHERE project_id = $1 AND stage_key = $2 AND member_id IS NOT DISTINCT FROM $3`,
      [projectId, input.stageKey, input.memberId]
    )
    const { rows } = await client.query<AutonomyPolicyRow>(
      `INSERT INTO autonomy_policies
         (tenant_id, project_id, stage_key, member_id, mode, min_runs, min_accept_rate,
          max_files, max_spend_cents, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${SELECT_COLUMNS}`,
      [
        tenantId,
        projectId,
        input.stageKey,
        input.memberId,
        input.mode,
        input.minRuns,
        input.minAcceptRate,
        input.maxFiles,
        input.maxSpendCents,
        createdBy,
        input.expiresAt
      ]
    )
    return toPolicy(rows[0]!)
  })
}
