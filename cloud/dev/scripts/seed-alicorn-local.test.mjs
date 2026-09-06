import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SEED_MEMBERS, main, seedMembers } from './seed-alicorn-local.mjs'

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
