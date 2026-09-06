#!/usr/bin/env node
import pg from 'pg'

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

// Why: one workflow that exercises the case WF2 is built around — the return edge. Stages carry the
// authored reversibility/inherited_cost; `review` also authors a required check, so the stage-over-project
// resolution has something real to resolve on a first run.
export const SEED_WORKFLOW = {
  projectId: 'local',
  name: 'Feature delivery',
  stages: [
    { key: 'spec', ordinal: 0, member: null, reversibility: 'free', inheritedCost: 'low', requiredChecks: [] },
    { key: 'build', ordinal: 1, member: 'Developer', reversibility: 'contained', inheritedCost: 'low', requiredChecks: [] },
    {
      key: 'review',
      ordinal: 2,
      member: 'Reviewer',
      reversibility: 'contained',
      inheritedCost: 'low',
      requiredChecks: [{ kind: 'diff_coverage', threshold: 0.8, lcovPath: 'coverage/lcov.info', timeoutMs: 600000 }]
    },
    { key: 'qa', ordinal: 3, member: 'QA', reversibility: 'contained', inheritedCost: 'low', requiredChecks: [] }
  ],
  transitions: [
    { from: 'spec', to: 'build', trigger: { kind: 'on_success' } },
    { from: 'build', to: 'review', trigger: { kind: 'on_success' } },
    { from: 'review', to: 'qa', trigger: { kind: 'on_success' } },
    { from: 'review', to: 'build', trigger: { kind: 'on_failure' } }
  ]
}

// Why: idempotent on (tenant_id, project_id, name), the same shape seedMembers uses — a rerun
// resolves the existing workflow id instead of inserting a second copy.
export async function seedWorkflows(client, tenantId, members) {
  const statements = []
  async function run(sql, params) {
    statements.push({ sql, params })
    return client.query(sql, params)
  }

  const memberIdByName = new Map(members.map((m) => [m.name, m.id]))
  const inserted = await run(
    `INSERT INTO workflows (tenant_id, project_id, name, created_by)
     VALUES ($1, $2, $3, 'seed')
     ON CONFLICT (tenant_id, project_id, name) DO NOTHING
     RETURNING id`,
    [tenantId, SEED_WORKFLOW.projectId, SEED_WORKFLOW.name]
  )
  let workflowId = inserted.rows[0]?.id
  if (!workflowId) {
    const existing = await run(
      `SELECT id FROM workflows WHERE tenant_id = $1 AND project_id = $2 AND name = $3`,
      [tenantId, SEED_WORKFLOW.projectId, SEED_WORKFLOW.name]
    )
    workflowId = existing.rows[0]?.id
  }

  for (const stage of SEED_WORKFLOW.stages) {
    await run(
      `INSERT INTO stages (tenant_id, workflow_id, key, name, ordinal, member_id, reversibility, inherited_cost, required_checks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (workflow_id, key) DO NOTHING`,
      [
        tenantId,
        workflowId,
        stage.key,
        stage.key,
        stage.ordinal,
        stage.member ? (memberIdByName.get(stage.member) ?? null) : null,
        stage.reversibility,
        stage.inheritedCost,
        JSON.stringify(stage.requiredChecks)
      ]
    )
  }

  for (const transition of SEED_WORKFLOW.transitions) {
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

function printResults(members, tenantId) {
  console.log('Seeded members:')
  for (const m of members) {
    console.log(`  ${m.name} (${m.role}/${m.backend}/${m.workspaceKind}/${m.permissionMode}) id=${m.id}`)
  }
  console.log('')
  console.log(`Seeded workflow: ${SEED_WORKFLOW.name} (${SEED_WORKFLOW.stages.map((s) => s.key).join(' -> ')})`)
  console.log('')
  console.log('Desktop env (see cloud/dev/compose/desktop.env.example):')
  console.log('  export ALICORN_CONTROL_API_URL=http://127.0.0.1:8081')
  console.log('  export ALICORN_LEDGER_API_URL=http://127.0.0.1:8082')
  console.log(`  export ALICORN_TENANT_ID=${tenantId}`)
  console.log(`  export ALICORN_LOCAL_API_TOKEN=${process.env.ALICORN_LOCAL_API_TOKEN ?? 'local-dev-token-change-me-0001'}`)
}

async function main() {
  const tenantId = process.env.ALICORN_TENANT_ID ?? 'local'
  const client = new pg.Client({ connectionString: resolveDatabaseUrl() })
  await client.connect()
  try {
    await client.query('BEGIN')
    const { members } = await seedMembers(client, tenantId)
    await seedWorkflows(client, tenantId, members)
    await client.query('COMMIT')
    printResults(members, tenantId)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
