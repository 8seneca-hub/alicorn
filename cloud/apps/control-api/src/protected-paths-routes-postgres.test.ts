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
import type { ProtectedPath } from '@alicorn-cloud/control-plane-contract'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_protected_paths_test'

describePostgres('protected paths routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'x-alicorn-actor': 'huy'
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({
      databaseUrl: appUrl,
      schema,
      applicationName: 'control-api-protected-paths-test'
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

  async function put(projectId: string, paths: unknown): Promise<Response> {
    return app.request(`/v1/projects/${projectId}/protected-paths`, {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ paths })
    })
  }

  it('answers an empty surface for a project that has authored nothing', async () => {
    const res = await app.request('/v1/projects/repo-unset/protected-paths', {
      headers: authHeaders
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paths: [] })
  })

  it('stores an authored surface and stamps the actor who authored it', async () => {
    const paths: ProtectedPath[] = [
      { kind: 'path', path: 'infra', reason: 'production topology' },
      { kind: 'extension', extension: '.tf' }
    ]
    expect((await put('repo-1', paths)).status).toBe(200)

    const get = await app.request('/v1/projects/repo-1/protected-paths', { headers: authHeaders })
    expect(await get.json()).toEqual({ paths })

    const row = await withTenant(pool, 'local', (client) =>
      client.query('SELECT updated_by FROM project_protected_paths WHERE project_id = $1', [
        'repo-1'
      ])
    )
    expect(row.rows[0].updated_by).toBe('huy')
  })

  it('replaces the surface rather than appending to it', async () => {
    await put('repo-2', [{ kind: 'path', path: 'a' }])
    await put('repo-2', [{ kind: 'path', path: 'b' }])
    const get = await app.request('/v1/projects/repo-2/protected-paths', { headers: authHeaders })
    expect(await get.json()).toEqual({ paths: [{ kind: 'path', path: 'b' }] })
  })

  it('rejects a rule of an unknown kind', async () => {
    const res = await put('repo-3', [{ kind: 'glob', pattern: '**/*.tf' }])
    expect(res.status).toBe(400)
  })

  it('rejects an empty path and an over-long surface', async () => {
    expect((await put('repo-3', [{ kind: 'path', path: '  ' }])).status).toBe(400)
    const tooMany = Array.from({ length: 201 }, (_, index) => ({
      kind: 'path',
      path: `dir-${index}`
    }))
    expect((await put('repo-3', tooMany)).status).toBe(400)
  })

  it('refuses an unauthenticated read', async () => {
    const res = await app.request('/v1/projects/repo-1/protected-paths')
    expect(res.status).toBe(401)
  })
})
