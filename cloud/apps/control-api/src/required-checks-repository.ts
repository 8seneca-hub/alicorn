import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import { RequiredChecksSchema, type RequiredCheck } from '@alicorn-cloud/control-plane-contract'
import { unknownSkillCheckIds } from './skills-repository.js'

export function getRequiredChecks(pool: pg.Pool, tenantId: string, projectId: string): Promise<RequiredCheck[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ checks: unknown }>(
      `SELECT checks FROM project_required_checks WHERE project_id = $1`,
      [projectId]
    )
    const row = rows[0]
    if (!row) return []
    // Why: parse stored JSONB back through the schema so defaults (lcovPath, timeoutMs) are always present.
    return RequiredChecksSchema.parse(row.checks)
  })
}

export type PutChecksResult =
  | { kind: 'ok'; checks: RequiredCheck[] }
  | { kind: 'unknown_skill'; skillIds: string[] }

// OP2b: a `skill` check is validated against the catalog in the same transaction that stores it,
// so a skill deleted mid-call cannot leave behind a check that names nothing.
export function putRequiredChecks(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  updatedBy: string,
  checks: RequiredCheck[]
): Promise<PutChecksResult> {
  return withTenant(pool, tenantId, async (client) => {
    const unknown = await unknownSkillCheckIds(client, projectId, checks)
    if (unknown.length > 0) return { kind: 'unknown_skill', skillIds: unknown }
    const { rows } = await client.query<{ checks: unknown }>(
      `INSERT INTO project_required_checks (tenant_id, project_id, checks, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (tenant_id, project_id) DO UPDATE SET
         checks = EXCLUDED.checks,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING checks`,
      [tenantId, projectId, JSON.stringify(checks), updatedBy]
    )
    const row = rows[0]!
    return { kind: 'ok', checks: RequiredChecksSchema.parse(row.checks) }
  })
}
