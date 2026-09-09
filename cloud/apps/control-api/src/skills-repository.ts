import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type {
  RequiredCheck,
  Skill,
  SkillInput,
  SkillVersion,
  SkillVersionInput
} from '@alicorn-cloud/control-plane-contract'

// The org skill catalog (OP2). Every statement runs inside `withTenant`: `skills` and
// `skill_versions` carry forced RLS, so a query that forgets it reads nothing rather than
// another organisation's catalog.

type SkillRow = {
  id: string
  tenant_id: string
  scope: string
  project_id: string | null
  name: string
  package_id: string | null
  latest_version_id: string | null
  created_by: string
  created_at: Date
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scope: row.scope as Skill['scope'],
    projectId: row.project_id,
    name: row.name,
    packageId: row.package_id,
    latestVersionId: row.latest_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString()
  }
}

type VersionRow = { skill_id: string; version_id: string; digest: string; manifest: unknown; published_at: Date }

function toVersion(row: VersionRow): SkillVersion {
  return {
    skillId: row.skill_id,
    versionId: row.version_id,
    digest: row.digest,
    manifest: (row.manifest ?? {}) as Record<string, unknown>,
    publishedAt: row.published_at.toISOString()
  }
}

export function listSkills(
  pool: pg.Pool,
  tenantId: string,
  filter: { scope?: string; projectId?: string }
): Promise<Skill[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<SkillRow>(
      `SELECT * FROM skills
        WHERE ($1::text IS NULL OR scope = $1)
          AND ($2::text IS NULL OR project_id = $2)
        ORDER BY name`,
      [filter.scope ?? null, filter.projectId ?? null]
    )
    return rows.map(toSkill)
  })
}

export function getSkill(
  pool: pg.Pool,
  tenantId: string,
  id: string
): Promise<{ skill: Skill; versions: SkillVersion[] } | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<SkillRow>(`SELECT * FROM skills WHERE id = $1`, [id])
    const row = rows[0]
    if (!row) return null
    const versions = await client.query<VersionRow>(
      `SELECT * FROM skill_versions WHERE skill_id = $1 ORDER BY published_at, version_id`,
      [id]
    )
    return { skill: toSkill(row), versions: versions.rows.map(toVersion) }
  })
}

export function createSkill(pool: pg.Pool, tenantId: string, createdBy: string, input: SkillInput): Promise<Skill> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<SkillRow>(
      `INSERT INTO skills (tenant_id, scope, project_id, name, package_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, input.scope, input.projectId, input.name, input.packageId, createdBy]
    )
    return toSkill(rows[0]!)
  })
}

/**
 * Idempotent on `(skill_id, version_id)`: re-publishing the same version leaves the first digest
 * and manifest in place. A version is what a stage check pins, so letting a second POST rewrite
 * one would silently change what an already-authored check means.
 */
export function publishSkillVersion(
  pool: pg.Pool,
  tenantId: string,
  skillId: string,
  input: SkillVersionInput
): Promise<SkillVersion | null> {
  return withTenant(pool, tenantId, async (client) => {
    const owned = await client.query(`SELECT 1 FROM skills WHERE id = $1`, [skillId])
    if (!owned.rowCount) return null
    await client.query(
      `INSERT INTO skill_versions (tenant_id, skill_id, version_id, digest, manifest)
       VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (skill_id, version_id) DO NOTHING`,
      [tenantId, skillId, input.versionId, input.digest, JSON.stringify(input.manifest)]
    )
    const { rows } = await client.query<VersionRow>(
      `SELECT * FROM skill_versions WHERE skill_id = $1 AND version_id = $2`,
      [skillId, input.versionId]
    )
    return toVersion(rows[0]!)
  })
}

export type LatestOutcome = 'ok' | 'not_found' | 'unknown_version'

export function setLatestVersion(
  pool: pg.Pool,
  tenantId: string,
  skillId: string,
  versionId: string
): Promise<{ outcome: LatestOutcome; skill?: Skill }> {
  return withTenant(pool, tenantId, async (client) => {
    const version = await client.query(
      `SELECT 1 FROM skill_versions WHERE skill_id = $1 AND version_id = $2`,
      [skillId, versionId]
    )
    if (!version.rowCount) {
      const exists = await client.query(`SELECT 1 FROM skills WHERE id = $1`, [skillId])
      return { outcome: exists.rowCount ? 'unknown_version' : 'not_found' }
    }
    const { rows } = await client.query<SkillRow>(
      `UPDATE skills SET latest_version_id = $2 WHERE id = $1 RETURNING *`,
      [skillId, versionId]
    )
    return { outcome: 'ok', skill: toSkill(rows[0]!) }
  })
}

/**
 * OP2b. Which `skill` checks in this set name something the catalog cannot honour, given the
 * project authoring them: an id outside the tenant, another project's skill, or a `versionId`
 * that was never published. Returns the offending `skillId`s — empty means the set is storable.
 *
 * Takes a client, not a pool, so a workflow save validates inside the same transaction that
 * writes it.
 */
export async function unknownSkillCheckIds(
  client: pg.PoolClient,
  projectId: string,
  checks: readonly RequiredCheck[]
): Promise<string[]> {
  const refs = checks.filter((check): check is Extract<RequiredCheck, { kind: 'skill' }> => check.kind === 'skill')
  if (refs.length === 0) return []
  const ids = [...new Set(refs.map((ref) => ref.skillId))]
  // RLS scopes this read to the tenant, so anything missing here is outside it.
  const { rows } = await client.query<{ id: string; project_id: string | null; version_id: string | null }>(
    `SELECT s.id, s.project_id, v.version_id
       FROM skills s LEFT JOIN skill_versions v ON v.skill_id = s.id
      WHERE s.id = ANY($1::text[])`,
    [ids]
  )
  const projectById = new Map<string, string | null>()
  const versionsById = new Map<string, Set<string>>()
  for (const row of rows) {
    projectById.set(row.id, row.project_id)
    if (row.version_id === null) continue
    const versions = versionsById.get(row.id) ?? new Set<string>()
    versions.add(row.version_id)
    versionsById.set(row.id, versions)
  }
  const unknown = refs.filter((ref) => {
    if (!projectById.has(ref.skillId)) return true
    const owner = projectById.get(ref.skillId)
    if (owner !== null && owner !== projectId) return true
    return ref.versionId !== undefined && !versionsById.get(ref.skillId)?.has(ref.versionId)
  })
  return [...new Set(unknown.map((ref) => ref.skillId))]
}
