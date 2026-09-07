import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SEED_MEMBERS, main, seedMembers, seedWorkflows } from './seed-alicorn-local.mjs'

function stubClient() {
  const calls = []
  let insertCount = 0
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.startsWith('INSERT INTO members')) {
        insertCount += 1
        return { rows: [{ id: `member-${insertCount}` }] }
      }
      return { rows: [] }
    }
  }
}

test('exports main as a function and does not invoke it on import (module guard, no env, no DB connection attempted)', () => {
  assert.equal(typeof main, 'function')
})

test('seeds Developer/Reviewer/QA with the specified role, backend, workspace and permission mode', () => {
  assert.deepEqual(SEED_MEMBERS, [
    { name: 'Developer', role: 'developer', backend: 'claude', workspaceKind: 'worktree', permissionMode: 'accept_edits' },
    { name: 'Reviewer', role: 'reviewer', backend: 'codex', workspaceKind: 'worktree', permissionMode: 'ask' },
    { name: 'QA', role: 'qa', backend: 'claude', workspaceKind: 'worktree', permissionMode: 'ask' }
  ])
})

test('seedMembers sets the tenant, upserts the three members, and links the code-review skill to Reviewer', async () => {
  const client = stubClient()
  const { members, statements } = await seedMembers(client, 'local')

  assert.equal(statements[0].sql, `SELECT set_config('app.tenant_id', $1, true)`)
  assert.deepEqual(statements[0].params, ['local'])

  const memberInserts = statements.filter((s) => s.sql.startsWith('INSERT INTO members'))
  assert.equal(memberInserts.length, 3)
  assert.match(memberInserts[0].sql, /ON CONFLICT \(tenant_id, name\) DO NOTHING/)
  assert.match(memberInserts[0].sql, /RETURNING id/)
  assert.deepEqual(memberInserts[0].params, ['local', 'Developer', 'developer', 'claude', 'worktree', 'accept_edits'])
  assert.deepEqual(memberInserts[1].params, ['local', 'Reviewer', 'reviewer', 'codex', 'worktree', 'ask'])
  assert.deepEqual(memberInserts[2].params, ['local', 'QA', 'qa', 'claude', 'worktree', 'ask'])

  const skillInserts = statements.filter((s) => s.sql.startsWith('INSERT INTO member_skills'))
  assert.equal(skillInserts.length, 1)
  const reviewer = members.find((m) => m.name === 'Reviewer')
  assert.deepEqual(skillInserts[0].params, ['local', reviewer.id, 'code-review'])

  assert.deepEqual(
    members.map((m) => m.name),
    ['Developer', 'Reviewer', 'QA']
  )
})

test('running seedMembers twice issues the identical statements (same SQL and params both times)', async () => {
  const first = await seedMembers(stubClient(), 'local')
  const second = await seedMembers(stubClient(), 'local')
  assert.deepEqual(first.statements, second.statements)
})

test('falls back to selecting the existing member id when the insert hits the unique-name conflict', async () => {
  const client = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params })
      if (sql.startsWith('INSERT INTO members')) return { rows: [] } // ON CONFLICT DO NOTHING: no row back
      if (sql.startsWith('SELECT id FROM members')) return { rows: [{ id: `existing-${params[1]}` }] }
      return { rows: [] }
    }
  }
  const { members, statements } = await seedMembers(client, 'local')
  assert.deepEqual(
    members.map((m) => m.id),
    ['existing-Developer', 'existing-Reviewer', 'existing-QA']
  )
  const skillInsert = statements.find((s) => s.sql.startsWith('INSERT INTO member_skills'))
  assert.deepEqual(skillInsert.params, ['local', 'existing-Reviewer', 'code-review'])
})

const TEMPLATE = {
  name: 'Feature delivery',
  stages: [
    { key: 'spec', name: 'Spec', ordinal: 0, memberRole: 'analyst', columnId: 'todo', reversibility: 'free', inheritedCost: 'low' },
    { key: 'build', name: 'Build', ordinal: 1, memberRole: 'developer', columnId: 'in-progress', reversibility: 'contained', inheritedCost: 'low' },
    { key: 'merge', name: 'Merge', ordinal: 2, memberRole: null, columnId: 'completed', reversibility: 'irreversible', inheritedCost: 'low' }
  ],
  transitions: [
    { from: 'spec', to: 'build', trigger: { kind: 'on_success' } },
    { from: 'build', to: 'merge', trigger: { kind: 'on_success' } },
    { from: 'build', to: 'spec', trigger: { kind: 'on_failure' } }
  ]
}

const SEED_MEMBER_ROWS = [
  { name: 'Developer', role: 'developer', id: 'member-1' },
  { name: 'Reviewer', role: 'reviewer', id: 'member-2' },
  { name: 'Analyst', role: 'analyst', id: 'member-3' }
]

function workflowClient() {
  return {
    async query(sql) {
      if (sql.startsWith('INSERT INTO workflows')) return { rows: [{ id: 'workflow-1' }] }
      return { rows: [] }
    }
  }
}

test('seedWorkflows writes the template graph and binds stage roles to the seeded members', async () => {
  const { workflowId, statements } = await seedWorkflows(workflowClient(), 'local', SEED_MEMBER_ROWS, TEMPLATE)
  assert.equal(workflowId, 'workflow-1')
  assert.match(statements[0].sql, /ON CONFLICT \(tenant_id, project_id, name\) DO NOTHING/)
  assert.deepEqual(statements[0].params, ['local', 'local', 'Feature delivery'])

  const stageInserts = statements.filter((s) => s.sql.startsWith('INSERT INTO stages'))
  assert.deepEqual(stageInserts.map((s) => s.params[2]), ['spec', 'build', 'merge'])
  assert.deepEqual(stageInserts.map((s) => s.params[3]), ['Spec', 'Build', 'Merge'])
  // Roles resolve to member ids; an unowned stage such as Merge stays null.
  assert.deepEqual(stageInserts.map((s) => s.params[5]), ['member-3', 'member-1', null])
  // Column each stage dispatches on; several stages may share one, which is why columnId exists.
  assert.deepEqual(stageInserts.map((s) => s.params[6]), ['todo', 'in-progress', 'completed'])
  assert.deepEqual(stageInserts.map((s) => s.params[7]), ['free', 'contained', 'irreversible'])
  // Checks are the operator's call — the template authors none.
  assert.deepEqual(stageInserts.map((s) => s.params[9]), ['[]', '[]', '[]'])

  const edgeInserts = statements.filter((s) => s.sql.startsWith('INSERT INTO transitions'))
  assert.deepEqual(
    edgeInserts.map((s) => [s.params[2], s.params[3], JSON.parse(s.params[4]).kind]),
    [
      ['spec', 'build', 'on_success'],
      ['build', 'merge', 'on_success'],
      ['build', 'spec', 'on_failure']
    ]
  )
})

test('seedWorkflows picks the same member per role every run', async () => {
  const duplicated = [
    { name: 'Zed', role: 'developer', id: 'member-z' },
    { name: 'Ada', role: 'developer', id: 'member-a' }
  ]
  const { statements } = await seedWorkflows(workflowClient(), 'local', duplicated, TEMPLATE)
  const build = statements.filter((s) => s.sql.startsWith('INSERT INTO stages'))[1]
  assert.equal(build.params[5], 'member-a')
})

test('running seedWorkflows twice issues the identical statements', async () => {
  const first = await seedWorkflows(workflowClient(), 'local', SEED_MEMBER_ROWS, TEMPLATE)
  const second = await seedWorkflows(workflowClient(), 'local', SEED_MEMBER_ROWS, TEMPLATE)
  assert.deepEqual(first.statements, second.statements)
})
