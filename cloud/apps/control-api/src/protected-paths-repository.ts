import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import { ProtectedPathsSchema, type ProtectedPath } from '@alicorn-cloud/control-plane-contract'

export function getProtectedPaths(
  pool: pg.Pool,
  tenantId: string,
  projectId: string
): Promise<ProtectedPath[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ paths: unknown }>(
      `SELECT paths FROM project_protected_paths WHERE project_id = $1`,
      [projectId]
    )
    const row = rows[0]
    if (!row) return []
    return ProtectedPathsSchema.parse(row.paths)
  })
}

export function putProtectedPaths(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  updatedBy: string,
  paths: ProtectedPath[]
): Promise<ProtectedPath[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ paths: unknown }>(
      `INSERT INTO project_protected_paths (tenant_id, project_id, paths, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (tenant_id, project_id) DO UPDATE SET
         paths = EXCLUDED.paths,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING paths`,
      [tenantId, projectId, JSON.stringify(paths), updatedBy]
    )
    const row = rows[0]!
    return ProtectedPathsSchema.parse(row.paths)
  })
}
