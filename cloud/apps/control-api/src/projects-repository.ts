import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type {
  Project,
  ProjectInput,
  ProjectSource
} from '@alicorn-cloud/control-plane-contract'

type ProjectRow = {
  id: string
  tenant_id: string
  name: string
  key: string
  context: string | null
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  repo_ids: string[] | null
  source_provider: string | null
  source_board_id: string | null
  source_identifier: string | null
  source_url: string | null
}

const SELECT_PROJECTS = `
  SELECT p.id, p.tenant_id, p.name, p.key, p.context, p.created_by, p.created_at, p.updated_at,
         p.source_provider, p.source_board_id, p.source_identifier, p.source_url,
         COALESCE(array_agg(r.repo_id ORDER BY r.repo_id) FILTER (WHERE r.repo_id IS NOT NULL), '{}') AS repo_ids
  FROM projects p
  LEFT JOIN project_repos r ON r.project_id = p.id`

/** Both halves or neither: a provider with no board id names nothing the API could call. */
function toSource(row: ProjectRow): ProjectSource | null {
  if (!row.source_provider || !row.source_board_id) {
    return null
  }
  return {
    provider: row.source_provider as ProjectSource['provider'],
    boardId: row.source_board_id,
    identifier: row.source_identifier ?? '',
    url: row.source_url
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    key: row.key,
    context: row.context ?? '',
    repoIds: row.repo_ids ?? [],
    source: toSource(row),
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }
}

export function listProjects(pool: pg.Pool, tenantId: string): Promise<Project[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<ProjectRow>(
      `${SELECT_PROJECTS} GROUP BY p.id ORDER BY p.name`
    )
    return rows.map(toProject)
  })
}

export function getProject(
  pool: pg.Pool,
  tenantId: string,
  projectId: string
): Promise<Project | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<ProjectRow>(
      `${SELECT_PROJECTS} WHERE p.id = $1 GROUP BY p.id`,
      [projectId]
    )
    const row = rows[0]
    return row ? toProject(row) : null
  })
}

/**
 * Rebinds the repositories in one statement pair rather than diffing.
 *
 * A repo already bound to another project moves rather than erroring: the alternative is a
 * half-applied set, and the primary key on (tenant_id, repo_id) is what actually guarantees one
 * project per repo. `ON CONFLICT` makes the move explicit instead of a constraint violation the
 * caller has to interpret.
 */
async function setRepos(
  client: pg.PoolClient,
  tenantId: string,
  projectId: string,
  repoIds: readonly string[]
): Promise<void> {
  await client.query(`DELETE FROM project_repos WHERE project_id = $1`, [projectId])
  if (repoIds.length === 0) return
  const unique = [...new Set(repoIds)]
  await client.query(
    `INSERT INTO project_repos (tenant_id, project_id, repo_id)
     SELECT $1, $2, unnest($3::text[])
     ON CONFLICT (tenant_id, repo_id) DO UPDATE SET project_id = EXCLUDED.project_id`,
    [tenantId, projectId, unique]
  )
}

export function createProject(
  pool: pg.Pool,
  tenantId: string,
  createdBy: string,
  input: ProjectInput
): Promise<Project> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO projects (tenant_id, name, key, context, created_by,
                             source_provider, source_board_id, source_identifier, source_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        tenantId,
        input.name,
        input.key,
        input.context,
        createdBy,
        input.source?.provider ?? null,
        input.source?.boardId ?? null,
        input.source?.identifier ?? null,
        input.source?.url ?? null
      ]
    )
    const id = rows[0]!.id
    await setRepos(client, tenantId, id, input.repoIds)
    const { rows: read } = await client.query<ProjectRow>(
      `${SELECT_PROJECTS} WHERE p.id = $1 GROUP BY p.id`,
      [id]
    )
    return toProject(read[0]!)
  })
}

export function updateProject(
  pool: pg.Pool,
  tenantId: string,
  projectId: string,
  input: ProjectInput
): Promise<Project | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE projects
          SET name = $2, key = $3, context = $4, updated_at = now(),
              source_provider = $5, source_board_id = $6, source_identifier = $7, source_url = $8
        WHERE id = $1`,
      [
        projectId,
        input.name,
        input.key,
        input.context,
        input.source?.provider ?? null,
        input.source?.boardId ?? null,
        input.source?.identifier ?? null,
        input.source?.url ?? null
      ]
    )
    if (rowCount === 0) return null
    await setRepos(client, tenantId, projectId, input.repoIds)
    const { rows } = await client.query<ProjectRow>(
      `${SELECT_PROJECTS} WHERE p.id = $1 GROUP BY p.id`,
      [projectId]
    )
    return toProject(rows[0]!)
  })
}

export function deleteProject(
  pool: pg.Pool,
  tenantId: string,
  projectId: string
): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const { rowCount } = await client.query(`DELETE FROM projects WHERE id = $1`, [projectId])
    return (rowCount ?? 0) > 0
  })
}

/**
 * The compatibility read path, and the reason none of this needed a migration.
 *
 * Every project-scoped route still receives an opaque id. If it names a project, it is one. If it
 * names a repository that has been bound to a project, the project answers for it — which is how
 * configuration moves from per-repo to per-project without rewriting a single stored row. If it
 * names neither, it is returned unchanged, so a tenant that has never created a project keeps the
 * pre-project behaviour exactly.
 *
 * That last clause is what makes adopting this opt-in: nothing changes for a repo until someone
 * binds it.
 */
export function resolveProjectId(
  pool: pg.Pool,
  tenantId: string,
  id: string
): Promise<string> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ project_id: string }>(
      `SELECT id AS project_id FROM projects WHERE id = $1
       UNION ALL
       SELECT project_id FROM project_repos WHERE repo_id = $1
       LIMIT 1`,
      [id]
    )
    return rows[0]?.project_id ?? id
  })
}
