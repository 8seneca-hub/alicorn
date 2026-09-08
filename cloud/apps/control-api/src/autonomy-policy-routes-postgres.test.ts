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
import type { AutonomyPolicy, StageConfig } from '@alicorn-cloud/control-plane-contract'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_autonomy_policy_test'

describePostgres('autonomy policy and stage config routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'x-alicorn-actor': 'huy'
  }
  const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({
      databaseUrl: appUrl,
      schema,
      applicationName: 'control-api-autonomy-test'
    })
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

  it('reports no authored policy rather than inventing one', async () => {
    const res = await app.request('/v1/projects/repo-1/autonomy-policy?stageKey=build', {
      headers: authHeaders
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ policy: null })
  })

  it('stores a policy and stamps created_by from the actor header', async () => {
    const put = await app.request('/v1/projects/repo-1/autonomy-policy', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ stageKey: 'build', mode: 'evidence', minRuns: 20 })
    })
    expect(put.status).toBe(200)
    const { policy } = (await put.json()) as { policy: AutonomyPolicy }
    expect(policy).toMatchObject({
      projectId: 'repo-1',
      stageKey: 'build',
      memberId: null,
      mode: 'evidence',
      minRuns: 20,
      minAcceptRate: 0.9,
      maxFiles: null,
      maxSpendCents: null,
      createdBy: 'huy'
    })
  })

  it('prefers a member-specific policy over the stage wildcard', async () => {
    await app.request('/v1/projects/repo-1/autonomy-policy', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ stageKey: 'build', memberId: 'member-a', mode: 'always_gate' })
    })

    const specific = await app.request(
      '/v1/projects/repo-1/autonomy-policy?stageKey=build&memberId=member-a',
      { headers: authHeaders }
    )
    const specificBody = (await specific.json()) as { policy: AutonomyPolicy }
    expect(specificBody.policy.mode).toBe('always_gate')

    const wildcard = await app.request(
      '/v1/projects/repo-1/autonomy-policy?stageKey=build&memberId=member-b',
      { headers: authHeaders }
    )
    const wildcardBody = (await wildcard.json()) as { policy: AutonomyPolicy }
    expect(wildcardBody.policy.mode).toBe('evidence')
  })

  it('replaces the row for a scope rather than accumulating duplicates', async () => {
    await app.request('/v1/projects/repo-1/autonomy-policy', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ stageKey: 'build', mode: 'evidence', minRuns: 30 })
    })
    const list = await app.request('/v1/projects/repo-1/autonomy-policies', {
      headers: authHeaders
    })
    const { policies } = (await list.json()) as { policies: AutonomyPolicy[] }
    expect(policies.filter((p) => p.stageKey === 'build' && p.memberId === null)).toHaveLength(1)
    expect(policies.find((p) => p.memberId === null)?.minRuns).toBe(30)
  })

  it('rejects never_gate without an expiry (a standing exception must lapse)', async () => {
    const res = await app.request('/v1/projects/repo-1/autonomy-policy', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ stageKey: 'review', mode: 'never_gate' })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_body')
  })

  it('accepts never_gate with an expiry and lists it for the audit view', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
    const put = await app.request('/v1/projects/repo-1/autonomy-policy', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ stageKey: 'review', mode: 'never_gate', expiresAt })
    })
    expect(put.status).toBe(200)

    const list = await app.request('/v1/projects/repo-1/autonomy-policies', {
      headers: authHeaders
    })
    const { policies } = (await list.json()) as { policies: AutonomyPolicy[] }
    const exception = policies.find((p) => p.stageKey === 'review')
    expect(exception?.mode).toBe('never_gate')
    expect(exception?.expiresAt).toBe(expiresAt)
  })

  it('refuses a never_gate row without an expiry at the database level too', async () => {
    await expect(
      withTenant(pool, 'local', (c) =>
        c.query(
          `INSERT INTO autonomy_policies (tenant_id, project_id, stage_key, mode, created_by)
           VALUES ('local', 'repo-2', 'build', 'never_gate', 'sql')`
        )
      )
    ).rejects.toThrow()
  })

  it('defaults merge and deploy to irreversible and high inherited cost', async () => {
    const merge = await app.request('/v1/projects/repo-1/stage-config/merge', {
      headers: authHeaders
    })
    expect(await merge.json()).toEqual({
      stageKey: 'merge',
      config: { reversibility: 'irreversible', inheritedCost: 'high' }
    })

    const build = await app.request('/v1/projects/repo-1/stage-config/build', {
      headers: authHeaders
    })
    expect(await build.json()).toEqual({
      stageKey: 'build',
      config: { reversibility: 'contained', inheritedCost: 'low' }
    })
  })

  it('stores an authored stage config and reads it back', async () => {
    const put = await app.request('/v1/projects/repo-1/stage-config/publish', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ reversibility: 'irreversible', inheritedCost: 'high' })
    })
    expect(put.status).toBe(200)

    const get = await app.request('/v1/projects/repo-1/stage-config/publish', {
      headers: authHeaders
    })
    const body = (await get.json()) as { config: StageConfig }
    expect(body.config).toEqual({ reversibility: 'irreversible', inheritedCost: 'high' })

    const row = await withTenant(pool, 'local', (c) =>
      c.query("SELECT updated_by FROM project_stage_config WHERE stage_key = 'publish'")
    )
    expect(row.rows[0].updated_by).toBe('huy')
  })

  it('rejects an unknown reversibility with 400', async () => {
    const res = await app.request('/v1/projects/repo-1/stage-config/publish', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ reversibility: 'maybe', inheritedCost: 'low' })
    })
    expect(res.status).toBe(400)
  })

  it('rejects a malformed stage key with 400', async () => {
    const res = await app.request('/v1/projects/repo-1/stage-config/Not%20A%20Stage', {
      headers: authHeaders
    })
    expect(res.status).toBe(400)
  })

  it('enforces RLS on the new tables at the database level', async () => {
    const policies = await withTenant(pool, 'other-tenant', (c) =>
      c.query('SELECT count(*)::int AS n FROM autonomy_policies')
    )
    expect(policies.rows[0].n).toBe(0)
    const configs = await withTenant(pool, 'other-tenant', (c) =>
      c.query('SELECT count(*)::int AS n FROM project_stage_config')
    )
    expect(configs.rows[0].n).toBe(0)
  })
})
