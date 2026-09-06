import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { OrgPolicy } from '@alicorn-cloud/control-plane-contract'

// Why: no row means the tenant never set a policy — default to the safe (enforcing) behaviour.
const DEFAULT_POLICY: OrgPolicy = { enforceDistinctReviewerBackend: true }

export function getOrgPolicy(pool: pg.Pool, tenantId: string): Promise<OrgPolicy> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ enforce_distinct_reviewer_backend: boolean }>(
      `SELECT enforce_distinct_reviewer_backend FROM org_policies`
    )
    const row = rows[0]
    if (!row) return DEFAULT_POLICY
    return { enforceDistinctReviewerBackend: row.enforce_distinct_reviewer_backend }
  })
}

export function putOrgPolicy(pool: pg.Pool, tenantId: string, updatedBy: string, policy: OrgPolicy): Promise<OrgPolicy> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ enforce_distinct_reviewer_backend: boolean }>(
      `INSERT INTO org_policies (tenant_id, enforce_distinct_reviewer_backend, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         enforce_distinct_reviewer_backend = EXCLUDED.enforce_distinct_reviewer_backend,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [tenantId, policy.enforceDistinctReviewerBackend, updatedBy]
    )
    const row = rows[0]!
    return { enforceDistinctReviewerBackend: row.enforce_distinct_reviewer_backend }
  })
}
