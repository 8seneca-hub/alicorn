import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { AutonomyLevel, OrgPolicy } from '@alicorn-cloud/control-plane-contract'

// Why: no row means the tenant never set a policy — default to the safe (enforcing) behaviour.
const DEFAULT_POLICY: OrgPolicy = {
  enforceDistinctReviewerBackend: true,
  defaultAutonomyLevel: 'L2'
}

type OrgPolicyRow = {
  enforce_distinct_reviewer_backend: boolean
  default_autonomy_level: string | null
}

function toPolicy(row: OrgPolicyRow): OrgPolicy {
  return {
    enforceDistinctReviewerBackend: row.enforce_distinct_reviewer_backend,
    defaultAutonomyLevel: (row.default_autonomy_level ??
      DEFAULT_POLICY.defaultAutonomyLevel) as AutonomyLevel
  }
}

export function getOrgPolicy(pool: pg.Pool, tenantId: string): Promise<OrgPolicy> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<OrgPolicyRow>(
      `SELECT enforce_distinct_reviewer_backend, default_autonomy_level FROM org_policies`
    )
    const row = rows[0]
    return row ? toPolicy(row) : DEFAULT_POLICY
  })
}

export function putOrgPolicy(pool: pg.Pool, tenantId: string, updatedBy: string, policy: OrgPolicy): Promise<OrgPolicy> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<OrgPolicyRow>(
      `INSERT INTO org_policies (tenant_id, enforce_distinct_reviewer_backend,
                                 default_autonomy_level, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         enforce_distinct_reviewer_backend = EXCLUDED.enforce_distinct_reviewer_backend,
         default_autonomy_level = EXCLUDED.default_autonomy_level,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [tenantId, policy.enforceDistinctReviewerBackend, policy.defaultAutonomyLevel, updatedBy]
    )
    return toPolicy(rows[0]!)
  })
}
