import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type { Member, MemberInput, MemberSkillRef } from '@alicorn-cloud/control-plane-contract'

type MemberRow = {
  id: string
  tenant_id: string
  name: string
  role: string
  backend: string
  workspace_kind: string
  permission_mode: string
  system_rules: string
  created_by: string
  created_at: Date
  updated_at: Date
}

function toMember(row: MemberRow, skills: MemberSkillRef[]): Member {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    role: row.role as Member['role'],
    backend: row.backend as Member['backend'],
    workspaceKind: row.workspace_kind as Member['workspaceKind'],
    permissionMode: row.permission_mode as Member['permissionMode'],
    systemRules: row.system_rules,
    skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)),
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }
}

// `skill_id` is the skill *name* (it predates the catalog and stays the key); `version_id` NULL
// follows the catalog's latest.
async function skillsFor(client: pg.PoolClient, memberId: string): Promise<MemberSkillRef[]> {
  const { rows } = await client.query<{ skill_id: string; version_id: string | null }>(
    `SELECT skill_id, version_id FROM member_skills WHERE member_id = $1`,
    [memberId]
  )
  return rows.map((r) => ({ name: r.skill_id, versionId: r.version_id }))
}

// Why: skills are replaced wholesale (not diffed) — simpler, and callers always send the full set.
async function replaceSkills(
  client: pg.PoolClient,
  tenantId: string,
  memberId: string,
  skills: MemberSkillRef[]
): Promise<void> {
  await client.query(`DELETE FROM member_skills WHERE member_id = $1`, [memberId])
  if (skills.length === 0) return
  const values: string[] = []
  const params: unknown[] = []
  skills.forEach((skill, i) => {
    values.push(`($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
    params.push(tenantId, memberId, skill.name, skill.versionId)
  })
  await client.query(
    `INSERT INTO member_skills (tenant_id, member_id, skill_id, version_id) VALUES ${values.join(', ')}`,
    params
  )
}

export function listMembers(pool: pg.Pool, tenantId: string): Promise<Member[]> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<MemberRow>(`SELECT * FROM members ORDER BY name`)
    const members: Member[] = []
    for (const row of rows) {
      members.push(toMember(row, await skillsFor(client, row.id)))
    }
    return members
  })
}

export function getMember(pool: pg.Pool, tenantId: string, id: string): Promise<Member | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<MemberRow>(`SELECT * FROM members WHERE id = $1`, [id])
    const row = rows[0]
    if (!row) return null
    return toMember(row, await skillsFor(client, row.id))
  })
}

export function createMember(pool: pg.Pool, tenantId: string, createdBy: string, input: MemberInput): Promise<Member> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<MemberRow>(
      `INSERT INTO members (tenant_id, name, role, backend, workspace_kind, permission_mode, system_rules, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenantId, input.name, input.role, input.backend, input.workspaceKind, input.permissionMode, input.systemRules, createdBy]
    )
    const row = rows[0]!
    await replaceSkills(client, tenantId, row.id, input.skills)
    return toMember(row, input.skills)
  })
}

export function updateMember(pool: pg.Pool, tenantId: string, id: string, input: MemberInput): Promise<Member | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<MemberRow>(
      `UPDATE members SET name = $1, role = $2, backend = $3, workspace_kind = $4, permission_mode = $5, system_rules = $6, updated_at = now()
       WHERE id = $7 RETURNING *`,
      [input.name, input.role, input.backend, input.workspaceKind, input.permissionMode, input.systemRules, id]
    )
    const row = rows[0]
    if (!row) return null
    await replaceSkills(client, tenantId, id, input.skills)
    return toMember(row, input.skills)
  })
}

export function deleteMember(pool: pg.Pool, tenantId: string, id: string): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const result = await client.query(`DELETE FROM members WHERE id = $1`, [id])
    return (result.rowCount ?? 0) > 0
  })
}
