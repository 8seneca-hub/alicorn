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
import { TrackRecordSchema, type TrackRecord } from '@alicorn-cloud/control-plane-contract'
import { createLedgerApiApp } from './app.js'
import { loadLedgerApiConfig } from './config.js'
import type { LedgerApiEnv } from './app-env.js'
import { LEDGER_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'ledger_track_record_test'

describePostgres('GET /v1/ledger/track-record (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<LedgerApiEnv>

  const authHeaders = { authorization: 'Bearer local-dev-token-0123456789' }

  async function read(query: string): Promise<TrackRecord> {
    const response = await app.request(`/v1/ledger/track-record?${query}`, { headers: authHeaders })
    expect(response.status).toBe(200)
    return TrackRecordSchema.parse(await response.json())
  }

  /** Inserted directly: the route reads raw outcomes, and the POST path is covered elsewhere. */
  async function seed(
    memberId: string,
    outcomes: { succeeded?: boolean; verdict?: string | null; minutesAgo: number }[]
  ): Promise<void> {
    await withTenant(pool, 'local', async (client) => {
      for (const [index, outcome] of outcomes.entries()) {
        await client.query(
          `INSERT INTO step_outcomes
             (tenant_id, run_id, task_id, dispatch_id, project_id, member_id, stage_key, outcome,
              human_verdict, created_at)
           VALUES ('local', 'run_tr', $1, $2, 'p_tr', $3, 'build', $4, $5, now() - ($6 || ' minutes')::interval)`,
          [
            `task_${memberId}_${index}`,
            `ctx_${memberId}_${index}`,
            memberId,
            outcome.succeeded === false ? 'failed' : 'succeeded',
            outcome.verdict ?? null,
            String(outcome.minutesAgo)
          ]
        )
      }
    })
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({
      databaseUrl: appUrl,
      schema,
      applicationName: 'ledger-api-track-record-test'
    })
    await applySchema(pool, LEDGER_SCHEMA_STATEMENTS)
    const config = loadLedgerApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789',
      ALICORN_TENANT_ID: 'local'
    })
    app = createLedgerApiApp({ config, pool })
  })

  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  it('reports an empty record rather than 404 for a member with no history', async () => {
    const record = await read('memberId=m_unknown&projectId=p_tr')
    expect(record).toMatchObject({ runs: 0, acceptRate: 0, level: 0, amendmentsObserved: false })
  })

  it('rejects a query with no member', async () => {
    const response = await app.request('/v1/ledger/track-record?projectId=p_tr', {
      headers: authHeaders
    })
    expect(response.status).toBe(400)
  })

  it('windows at the last 50 runs and ignores the 51st', async () => {
    // 50 clean runs, plus one older failure that must fall outside the window.
    await seed('m_window', [
      { minutesAgo: 5000, succeeded: false },
      ...Array.from({ length: 50 }, (_, i) => ({ minutesAgo: 100 - i }))
    ])
    const record = await read('memberId=m_window&projectId=p_tr')
    expect(record.runs).toBe(50)
    expect(record.accepted).toBe(50)
    expect(record.acceptRate).toBe(1)
    // No human has ever corrected this member, so the accept rate is unproven: advisory at most.
    expect(record.amendmentsObserved).toBe(false)
    expect(record.level).toBe(1)
  })

  it('demotes on a recent rejection and counts a human verdict over the reported outcome', async () => {
    await seed('m_regress', [
      { minutesAgo: 1, verdict: 'rejected' },
      { minutesAgo: 2, verdict: 'accepted' },
      ...Array.from({ length: 23 }, (_, i) => ({ minutesAgo: 10 + i, verdict: 'accepted' }))
    ])
    const record = await read('memberId=m_regress&projectId=p_tr')
    expect(record.runs).toBe(25)
    expect(record.rejected).toBe(1)
    expect(record.accepted).toBe(24)
    expect(record.recentRegression).toBe(true)
    expect(record.amendmentsObserved).toBe(true)
    // 25 runs at 0.96 would be level 2; the rejection inside the last ten drops it to 1.
    expect(record.level).toBe(1)
  })

  it('treats two amendments in the last ten as a regression and reports the newest', async () => {
    await seed('m_amended', [
      { minutesAgo: 1, verdict: 'amended' },
      { minutesAgo: 2, verdict: 'amended' },
      ...Array.from({ length: 20 }, (_, i) => ({ minutesAgo: 10 + i, verdict: 'accepted' }))
    ])
    const record = await read('memberId=m_amended&projectId=p_tr')
    expect(record.amended).toBe(2)
    expect(record.recentRegression).toBe(true)
    expect(record.lastAmendedAt).not.toBeNull()
    expect(Date.parse(record.lastAmendedAt!)).toBeGreaterThan(Date.now() - 5 * 60_000)
  })

  it('scopes the window to one project and stage', async () => {
    await seed('m_scoped', [{ minutesAgo: 1 }, { minutesAgo: 2 }])
    expect((await read('memberId=m_scoped&projectId=p_other')).runs).toBe(0)
    expect((await read('memberId=m_scoped&projectId=p_tr&stageKey=review')).runs).toBe(0)
    expect((await read('memberId=m_scoped&projectId=p_tr&stageKey=build')).runs).toBe(2)
  })
})
