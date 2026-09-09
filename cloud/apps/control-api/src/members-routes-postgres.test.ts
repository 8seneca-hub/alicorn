import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applySchema,
  createTestSchema,
  dropTestSchema,
  openControlPlanePool,
  withTenant
} from '@alicorn-cloud/control-plane-postgres'
import type { Hono } from 'hono'
import type { Member } from '@alicorn-cloud/control-plane-contract'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_members_test'

describePostgres('members routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>
  let memberId: string

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'x-alicorn-actor': 'huy'
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-members-test' })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    const config = loadControlApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789',
      ALICORN_TENANT_ID: 'local'
    })
    app = createControlApiApp({ config, pool })
  })

  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  it('creates a member and stamps createdBy from the actor header', async () => {
    const res = await app.request('/v1/members', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Reviewer',
        role: 'reviewer',
        backend: 'codex',
        workspaceKind: 'worktree',
        permissionMode: 'ask',
        skills: ['code-review']
      })
    })
    expect(res.status).toBe(201)
    const { member } = (await res.json()) as { member: Member }
    expect(member.createdBy).toBe('huy')
    // OP2: a bare string still parses, and comes back as a follow-latest catalog ref.
    expect(member.skills).toEqual([{ name: 'code-review', versionId: null }])
    memberId = member.id
  })

  it('lists members for the tenant', async () => {
    const res = await app.request('/v1/members', { headers: authHeaders })
    expect(res.status).toBe(200)
    const { members } = (await res.json()) as { members: Member[] }
    expect(members).toHaveLength(1)
  })

  it('enforces RLS at the database level, not just in application queries', async () => {
    const other = await withTenant(pool, 'other-tenant', (c) => c.query('SELECT count(*)::int AS n FROM members'))
    expect(other.rows[0].n).toBe(0)
    const mine = await withTenant(pool, 'local', (c) => c.query('SELECT count(*)::int AS n FROM members'))
    expect(mine.rows[0].n).toBe(1)
  })

  it('updates a member, replacing its skills atomically', async () => {
    const res = await app.request(`/v1/members/${memberId}`, {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Reviewer',
        role: 'reviewer',
        backend: 'claude',
        workspaceKind: 'worktree',
        permissionMode: 'ask',
        skills: ['tdd', 'code-review']
      })
    })
    expect(res.status).toBe(200)
    const { member } = (await res.json()) as { member: Member }
    expect(member.backend).toBe('claude')
    expect(member.skills).toEqual([
      { name: 'code-review', versionId: null },
      { name: 'tdd', versionId: null }
    ])
  })

  it('rejects a duplicate name with 409', async () => {
    const res = await app.request('/v1/members', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Reviewer',
        role: 'developer',
        backend: 'codex',
        workspaceKind: 'folder',
        permissionMode: 'ask'
      })
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'duplicate_name' })
  })

  it('rejects an invalid body with 400', async () => {
    const res = await app.request('/v1/members', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Someone',
        role: 'developer',
        backend: 'gemini',
        workspaceKind: 'folder',
        permissionMode: 'ask'
      })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; issues: unknown[] }
    expect(body.error).toBe('invalid_body')
    expect(Array.isArray(body.issues)).toBe(true)
  })

  it('rejects duplicate skills in the body with 400', async () => {
    const res = await app.request('/v1/members', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Someone Else',
        role: 'developer',
        backend: 'codex',
        workspaceKind: 'folder',
        permissionMode: 'ask',
        skills: ['tdd', 'tdd']
      })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_body')
  })

  it('rejects malformed JSON with 400 invalid_body', async () => {
    const res = await app.request('/v1/members', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: '{not json'
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body', issues: [] })
  })

  it('rejects a mismatched org header with 403', async () => {
    const res = await app.request('/v1/members', { headers: { ...authHeaders, 'x-alicorn-org': 'acme' } })
    expect(res.status).toBe(403)
  })

  it('deletes a member', async () => {
    const del = await app.request(`/v1/members/${memberId}`, { method: 'DELETE', headers: authHeaders })
    expect(del.status).toBe(204)
    const get = await app.request(`/v1/members/${memberId}`, { headers: authHeaders })
    expect(get.status).toBe(404)
  })
})
