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
import type { OrgPolicy, RequiredCheck } from '@alicorn-cloud/control-plane-contract'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_policy_test'

describePostgres('org policy and required checks routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'x-alicorn-actor': 'huy'
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-policy-test' })
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

  it('returns the safe default policy when no row exists', async () => {
    const res = await app.request('/v1/policy/review-backend', { headers: authHeaders })
    expect(res.status).toBe(200)
    const policy = (await res.json()) as OrgPolicy
    expect(policy).toEqual({ enforceDistinctReviewerBackend: true, defaultAutonomyLevel: 'L2' })
  })

  it('updates the policy and stamps updated_by from the actor header', async () => {
    const put = await app.request('/v1/policy/review-backend', {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ enforceDistinctReviewerBackend: false })
    })
    expect(put.status).toBe(200)

    const get = await app.request('/v1/policy/review-backend', { headers: authHeaders })
    expect(get.status).toBe(200)
    const policy = (await get.json()) as OrgPolicy
    expect(policy.enforceDistinctReviewerBackend).toBe(false)

    const row = await withTenant(pool, 'local', (c) => c.query('SELECT updated_by FROM org_policies'))
    expect(row.rows[0].updated_by).toBe('huy')
  })

  it('rejects an invalid policy body with 400', async () => {
    const res = await app.request('/v1/policy/review-backend', {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ enforceDistinctReviewerBackend: 'nope' })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_body')
  })

  it('returns no required checks for a project with no row', async () => {
    const res = await app.request('/v1/projects/repo-1/required-checks', { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checks: [] })
  })

  it('sets required checks for a project and applies schema defaults on read', async () => {
    const put = await app.request('/v1/projects/repo-1/required-checks', {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [{ kind: 'diff_coverage', threshold: 0.8 }] })
    })
    expect(put.status).toBe(200)

    const get = await app.request('/v1/projects/repo-1/required-checks', { headers: authHeaders })
    expect(get.status).toBe(200)
    const { checks } = (await get.json()) as { checks: RequiredCheck[] }
    expect(checks).toEqual([
      { kind: 'diff_coverage', threshold: 0.8, lcovPath: 'coverage/lcov.info', timeoutMs: 600000 }
    ])
  })

  it('stores one integration_verify check per repo, authored here and nowhere else', async () => {
    const checks = [
      { kind: 'integration_verify', command: 'pnpm run test:integration', repoId: 'repo-api' },
      { kind: 'integration_verify', command: 'make e2e', repoId: 'repo-web' }
    ]
    const put = await app.request('/v1/projects/repo-1/required-checks', {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ checks })
    })
    expect(put.status).toBe(200)

    const get = await app.request('/v1/projects/repo-1/required-checks', { headers: authHeaders })
    expect(await get.json()).toEqual({ checks })
  })

  /**
   * A stage's own checks were authored and stored from the first workflow and read by nothing,
   * which is what made "0 checks" true on every row. `stageKey` is what makes them count.
   */
  it('adds a stage’s own checks to the project’s when a stage is named', async () => {
    await app.request('/v1/projects/repo-1/required-checks', {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [{ kind: 'contract_acknowledged' }] })
    })
    const created = await app.request('/v1/workflows', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'repo-1',
        name: 'Delivery',
        stages: [
          { key: 'spec', ordinal: 0 },
          { key: 'review', ordinal: 1, requiredChecks: [{ kind: 'diff_coverage', threshold: 0.8 }] }
        ],
        transitions: []
      })
    })
    expect(created.status).toBe(201)

    // Without a stage, the answer is the project's list and nothing else — the old behaviour.
    const project = await app.request('/v1/projects/repo-1/required-checks', {
      headers: authHeaders
    })
    expect(((await project.json()) as { checks: RequiredCheck[] }).checks).toEqual([
      { kind: 'contract_acknowledged' }
    ])

    // A stage requires more than the project, never less.
    const review = await app.request('/v1/projects/repo-1/required-checks?stageKey=review', {
      headers: authHeaders
    })
    expect(((await review.json()) as { checks: RequiredCheck[] }).checks).toEqual([
      { kind: 'contract_acknowledged' },
      { kind: 'diff_coverage', threshold: 0.8, lcovPath: 'coverage/lcov.info', timeoutMs: 600000 }
    ])

    // A stage that authored none still clears the project's floor.
    const spec = await app.request('/v1/projects/repo-1/required-checks?stageKey=spec', {
      headers: authHeaders
    })
    expect(((await spec.json()) as { checks: RequiredCheck[] }).checks).toEqual([
      { kind: 'contract_acknowledged' }
    ])
  })

  it('rejects an invalid required check body with 400', async () => {
    const res = await app.request('/v1/projects/repo-1/required-checks', {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [{ kind: 'nope' }] })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_body')
  })

  it('enforces RLS on project_required_checks at the database level', async () => {
    const other = await withTenant(pool, 'other-tenant', (c) => c.query('SELECT count(*)::int AS n FROM project_required_checks'))
    expect(other.rows[0].n).toBe(0)
  })

  it('rejects a mismatched org header with 403', async () => {
    const res = await app.request('/v1/policy/review-backend', { headers: { ...authHeaders, 'x-alicorn-org': 'acme' } })
    expect(res.status).toBe(403)
  })
})
