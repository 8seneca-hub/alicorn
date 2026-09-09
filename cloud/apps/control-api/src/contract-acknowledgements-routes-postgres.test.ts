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
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_contract_ack_test'

describePostgres('contract acknowledgement routes (postgres)', () => {
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
      applicationName: 'control-api-contract-ack-test'
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

  async function acknowledge(projectId: string, body: unknown, actor = 'huy'): Promise<Response> {
    return app.request(`/v1/projects/${encodeURIComponent(projectId)}/contracts/acknowledge`, {
      method: 'POST',
      headers: { ...authHeaders, 'x-alicorn-actor': actor, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  async function list(projectId: string, query: string): Promise<Response> {
    return app.request(
      `/v1/projects/${encodeURIComponent(projectId)}/contracts/acknowledgements${query}`,
      { headers: authHeaders }
    )
  }

  it('records an acknowledgement and reads it back for the run', async () => {
    const res = await acknowledge('proj_a', {
      runId: 'run_1',
      contractNames: ['GET /refunds/{id}', 'RefundRequest']
    })
    expect(res.status).toBe(200)

    const read = await list('proj_a', '?runId=run_1')
    expect(read.status).toBe(200)
    const body = (await read.json()) as { acknowledgements: { contractName: string; acknowledgedBy: string }[] }
    expect(body.acknowledgements.map((a) => a.contractName)).toEqual([
      'GET /refunds/{id}',
      'RefundRequest'
    ])
    expect(body.acknowledgements[0]!.acknowledgedBy).toBe('huy')
  })

  it('scopes acknowledgements by run and by project', async () => {
    await acknowledge('proj_b', { runId: 'run_2', contractNames: ['Widget'] })
    const otherRun = (await (await list('proj_b', '?runId=run_3')).json()) as {
      acknowledgements: unknown[]
    }
    expect(otherRun.acknowledgements).toEqual([])
    const otherProject = (await (await list('proj_c', '?runId=run_2')).json()) as {
      acknowledgements: unknown[]
    }
    expect(otherProject.acknowledgements).toEqual([])
  })

  it('keeps the first acknowledger when the same contract is posted twice', async () => {
    await acknowledge('proj_d', { runId: 'run_4', contractNames: ['Invoice'] }, 'first')
    await acknowledge('proj_d', { runId: 'run_4', contractNames: ['Invoice'] }, 'second')
    const body = (await (await list('proj_d', '?runId=run_4')).json()) as {
      acknowledgements: { acknowledgedBy: string }[]
    }
    expect(body.acknowledgements).toHaveLength(1)
    expect(body.acknowledgements[0]!.acknowledgedBy).toBe('first')
  })

  it('rejects a listing with no run and a body with no names', async () => {
    expect((await list('proj_a', '')).status).toBe(400)
    expect((await acknowledge('proj_a', { runId: 'run_1', contractNames: [] })).status).toBe(400)
    expect((await acknowledge('proj_a', { contractNames: ['x'] })).status).toBe(400)
  })

  it('forces row-level security — another tenant sees nothing', async () => {
    await acknowledge('proj_e', { runId: 'run_5', contractNames: ['Secret'] })
    const rows = await withTenant(pool, 'other-tenant', async (client) =>
      client.query(`SELECT contract_name FROM contract_acknowledgements WHERE run_id = 'run_5'`)
    )
    expect(rows.rowCount).toBe(0)
  })
})
