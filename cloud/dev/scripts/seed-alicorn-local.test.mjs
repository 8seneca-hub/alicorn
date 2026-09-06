import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SEED_MEMBERS, seedMembers, seedWorkflows } from './seed-alicorn-local.mjs'

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

test('seedWorkflows upserts the Feature delivery graph, assigns members by name, and keeps the return edge', async () => {
  const client = {
    async query(sql, params) {
      if (sql.startsWith('INSERT INTO workflows')) return { rows: [{ id: 'workflow-1' }] }
      return { rows: [] }
    }
  }
  const members = [
    { name: 'Developer', id: 'member-1' },
    { name: 'Reviewer', id: 'member-2' },
    { name: 'QA', id: 'member-3' }
  ]
  const { workflowId, statements } = await seedWorkflows(client, 'local', members)
  assert.equal(workflowId, 'workflow-1')
  assert.match(statements[0].sql, /ON CONFLICT \(tenant_id, project_id, name\) DO NOTHING/)

  const stageInserts = statements.filter((s) => s.sql.startsWith('INSERT INTO stages'))
  assert.equal(stageInserts.length, 4)
  assert.deepEqual(
    stageInserts.map((s) => s.params[2]),
    ['spec', 'build', 'review', 'qa']
  )
  // spec is unassigned; build/review/qa resolve to the seeded member ids by name.
  assert.deepEqual(
    stageInserts.map((s) => s.params[5]),
    [null, 'member-1', 'member-2', 'member-3']
  )
  // The review stage authors a check, so stage-over-project resolution has something to resolve.
  assert.match(stageInserts[2].params[8], /diff_coverage/)

  const edgeInserts = statements.filter((s) => s.sql.startsWith('INSERT INTO transitions'))
  assert.deepEqual(
    edgeInserts.map((s) => [s.params[2], s.params[3], JSON.parse(s.params[4]).kind]),
    [
      ['spec', 'build', 'on_success'],
      ['build', 'review', 'on_success'],
      ['review', 'qa', 'on_success'],
      ['review', 'build', 'on_failure']
    ]
  )
})

test('running seedWorkflows twice issues the identical statements', async () => {
  const stub = () => ({
    async query(sql) {
      if (sql.startsWith('INSERT INTO workflows')) return { rows: [{ id: 'workflow-1' }] }
      return { rows: [] }
    }
  })
  const members = [{ name: 'Developer', id: 'member-1' }, { name: 'Reviewer', id: 'member-2' }, { name: 'QA', id: 'member-3' }]
  const first = await seedWorkflows(stub(), 'local', members)
  const second = await seedWorkflows(stub(), 'local', members)
  assert.deepEqual(first.statements, second.statements)
})
