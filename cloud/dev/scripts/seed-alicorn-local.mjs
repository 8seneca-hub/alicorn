#!/usr/bin/env node
import pg from 'pg'
import { pathToFileURL } from 'node:url'
// Why: built output, not source — the seed is plain Node. `pnpm alicorn:seed` builds the contract first.
import { FEATURE_DELIVERY_TEMPLATE } from '../../packages/control-plane-contract/dist/workflow-template.js'

// Why: matches the members the Members UI expects for a first run — one of each
// role tier1 needs (developer/reviewer/qa), with the Reviewer carrying the
// code-review skill so R4 (reviewer backend != author backend) has something to check.
export const SEED_MEMBERS = [
  { name: 'Developer', role: 'developer', backend: 'claude', workspaceKind: 'worktree', permissionMode: 'accept_edits' },
  { name: 'Reviewer', role: 'reviewer', backend: 'codex', workspaceKind: 'worktree', permissionMode: 'ask' },
  { name: 'QA', role: 'qa', backend: 'claude', workspaceKind: 'worktree', permissionMode: 'ask' }
]

// Why: `members_tenant_name` makes this idempotent — a rerun upserts nothing new and
// looks up the existing id instead, so the skill link still resolves the right member.
export async function seedMembers(client, tenantId) {
  const statements = []
  async function run(sql, params) {
    statements.push({ sql, params })
    return client.query(sql, params)
  }

  await run(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])

  const members = []
  for (const member of SEED_MEMBERS) {
    const inserted = await run(
      `INSERT INTO members (tenant_id, name, role, backend, workspace_kind, permission_mode, system_rules, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, '', 'seed')
       ON CONFLICT (tenant_id, name) DO NOTHING
       RETURNING id`,
      [tenantId, member.name, member.role, member.backend, member.workspaceKind, member.permissionMode]
    )
    let id = inserted.rows[0]?.id
    if (!id) {
      const existing = await run(`SELECT id FROM members WHERE tenant_id = $1 AND name = $2`, [tenantId, member.name])
      id = existing.rows[0]?.id
    }
    members.push({ ...member, id })
  }

  const reviewer = members.find((m) => m.name === 'Reviewer')
  await run(
    `INSERT INTO member_skills (tenant_id, member_id, skill_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [tenantId, reviewer.id, 'code-review']
  )

  return { members, statements }
}

// Why: the template is the single definition of Feature delivery (WF4) — the seed binds its roles to
// the seeded members rather than keeping a second copy of the graph that could drift from it.
export async function seedWorkflows(client, tenantId, members, template) {
  const projectId = 'local'
  const statements = []
  async function run(sql, params) {
    statements.push({ sql, params })
    return client.query(sql, params)
  }

  // Why: same deterministic pick as the API's from-template route — first member of a role by name.
  const memberIdByRole = new Map()
  for (const member of [...members].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!memberIdByRole.has(member.role)) memberIdByRole.set(member.role, member.id)
  }
  const inserted = await run(
    `INSERT INTO workflows (tenant_id, project_id, name, created_by)
     VALUES ($1, $2, $3, 'seed')
     ON CONFLICT (tenant_id, project_id, name) DO NOTHING
     RETURNING id`,
    [tenantId, projectId, template.name]
  )
  let workflowId = inserted.rows[0]?.id
  if (!workflowId) {
    const existing = await run(
      `SELECT id FROM workflows WHERE tenant_id = $1 AND project_id = $2 AND name = $3`,
      [tenantId, projectId, template.name]
    )
    workflowId = existing.rows[0]?.id
  }

  for (const stage of template.stages) {
    await run(
      `INSERT INTO stages (tenant_id, workflow_id, key, name, ordinal, member_id, column_id, reversibility, inherited_cost, required_checks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (workflow_id, key) DO NOTHING`,
      [
        tenantId,
        workflowId,
        stage.key,
        stage.name,
        stage.ordinal,
        stage.memberRole ? (memberIdByRole.get(stage.memberRole) ?? null) : null,
        stage.columnId ?? null,
        stage.reversibility,
        stage.inheritedCost,
        '[]'
      ]
    )
  }

  for (const transition of template.transitions) {
    await run(
      `INSERT INTO transitions (tenant_id, workflow_id, from_stage, to_stage, trigger)
       SELECT $1, $2, f.id, t.id, $5::jsonb
       FROM stages f, stages t
       WHERE f.workflow_id = $2 AND f.key = $3 AND t.workflow_id = $2 AND t.key = $4
       ON CONFLICT (workflow_id, from_stage, to_stage) DO NOTHING`,
      [tenantId, workflowId, transition.from, transition.to, JSON.stringify(transition.trigger)]
    )
  }

  return { workflowId, statements }
}

function resolveDatabaseUrl() {
  const port = process.env.ALICORN_PG_PORT ?? '5432'
  const raw = process.env.ALICORN_DATABASE_URL ?? `postgres://alicorn_app:alicorn_app@127.0.0.1:${port}/alicorn`
  const url = new URL(raw)
  // Why: the members table lives in the control schema; match `openControlPlanePool`'s convention.
  url.searchParams.set('options', '-c search_path=control')
  return url.toString()
}

function printResults(members, tenantId, template) {
  console.log('Seeded members:')
  for (const m of members) {
    console.log(`  ${m.name} (${m.role}/${m.backend}/${m.workspaceKind}/${m.permissionMode}) id=${m.id}`)
  }
  console.log('')
  console.log(`Seeded workflow: ${template.name} (${template.stages.map((s) => s.key).join(' -> ')})`)
  console.log('')
  console.log('Desktop env (see cloud/dev/compose/desktop.env.example):')
  console.log('  export ALICORN_CONTROL_API_URL=http://127.0.0.1:8081')
  console.log('  export ALICORN_LEDGER_API_URL=http://127.0.0.1:8082')
  console.log(`  export ALICORN_TENANT_ID=${tenantId}`)
  console.log(`  export ALICORN_LOCAL_API_TOKEN=${process.env.ALICORN_LOCAL_API_TOKEN ?? 'local-dev-token-change-me-0001'}`)
}

export async function main() {
  const tenantId = process.env.ALICORN_TENANT_ID ?? 'local'
  const client = new pg.Client({ connectionString: resolveDatabaseUrl() })
  await client.connect()
  try {
    await client.query('BEGIN')
    const { members } = await seedMembers(client, tenantId)
    await seedWorkflows(client, tenantId, members, FEATURE_DELIVERY_TEMPLATE)
    await client.query('COMMIT')
    printResults(members, tenantId, FEATURE_DELIVERY_TEMPLATE)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

// Why: import.meta.url vs. a resolved file:// URL — endsWith on a basename breaks on Windows
// (backslash paths) and matches any script sharing this file's basename (I2).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
