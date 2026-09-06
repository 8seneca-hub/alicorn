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
import { ProvenanceReportSchema, RunCostSchema } from '@alicorn-cloud/control-plane-contract'
import type { ProvenanceReport, RunCost } from '@alicorn-cloud/control-plane-contract'
import { createLedgerApiApp } from './app.js'
import { loadLedgerApiConfig } from './config.js'
import type { LedgerApiEnv } from './app-env.js'
import { LEDGER_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'ledger_routes_test'

describePostgres('ledger routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<LedgerApiEnv>
  let ctx2Id: string

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'content-type': 'application/json'
  }

  function post(path: string, body: unknown) {
    return app.request(path, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) })
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'ledger-api-routes-test' })
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

  it('absorbs duplicate deliveries and keeps retries (exactly-once)', async () => {
    const body = {
      runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1', outcome: 'succeeded',
      memberId: 'm1', projectId: 'p1', repoId: 'r1', branch: 'feat/x'
    }
    // Why: race N=4 identical deliveries concurrently — the first-write-wins path only proves
    // exactly-once if no delivery is privileged by being awaited on its own beforehand.
    const responses = await Promise.all([1, 2, 3, 4].map(() => post('/v1/ledger/step-outcomes', body)))
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 201])
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as { id: string; duplicate: boolean }[]
    const ids = new Set(bodies.map((b) => b.id))
    expect(ids.size).toBe(1)
    expect(bodies.filter((b) => !b.duplicate)).toHaveLength(1)

    const retry = await post('/v1/ledger/step-outcomes', {
      ...body, dispatchId: 'ctx_2', outcome: 'failed', reviewBackendBypass: true
    })
    expect(retry.status).toBe(201)
    const retryBody = (await retry.json()) as { id: string; duplicate: boolean }
    ctx2Id = retryBody.id

    const { rows } = await withTenant(pool, 'local', (c) =>
      c.query(`SELECT runs, accepted FROM member_stage_stats WHERE member_id = 'm1'`)
    )
    expect(rows[0]).toEqual({ runs: 2, accepted: 1 })

    const count = await withTenant(pool, 'local', (c) => c.query(`SELECT count(*)::int AS n FROM step_outcomes`))
    expect(count.rows[0].n).toBe(2)
  })

  it('is idempotent for step verifications but allows status to change on re-run', async () => {
    const body = {
      runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1',
      kind: 'diff_coverage', name: 'Diff coverage ≥ 80%', required: true,
      status: 'failed', detail: { ratio: 0.6 }
    }
    const first = await post('/v1/ledger/step-verifications', body)
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { id: string; duplicate: boolean }

    const second = await post('/v1/ledger/step-verifications', { ...body, status: 'passed' })
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { id: string; duplicate: boolean }
    expect(secondBody.duplicate).toBe(true)
    expect(secondBody.id).toBe(firstBody.id)

    const { rows } = await withTenant(pool, 'local', (c) =>
      c.query(`SELECT status FROM step_verifications WHERE id = $1`, [firstBody.id])
    )
    expect(rows[0].status).toBe('passed')
  })

  it('captures context exactly once, rejects oversized prompts, and rejects both fields', async () => {
    const body = { runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1', prompt: 'hello', contextSlice: { taskSpec: 'x' } }
    const first = await post('/v1/ledger/context-captures', body)
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { id: string; duplicate: boolean }

    const second = await post('/v1/ledger/context-captures', body)
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { id: string; duplicate: boolean }
    expect(secondBody.duplicate).toBe(true)
    expect(secondBody.id).toBe(firstBody.id)

    const tooLarge = await post('/v1/ledger/context-captures', {
      runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_3', prompt: 'x'.repeat(65 * 1024)
    })
    expect(tooLarge.status).toBe(413)
    expect(await tooLarge.json()).toEqual({ error: 'prompt_too_large' })

    const both = await post('/v1/ledger/context-captures', {
      runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_4', prompt: 'hi', promptPath: '/tmp/x'
    })
    expect(both.status).toBe(400)
  })

  it('patches spend and reports run cost', async () => {
    const patch = await app.request(`/v1/ledger/step-outcomes/${ctx2Id}/spend`, {
      method: 'PATCH', headers: authHeaders,
      body: JSON.stringify({ spendCents: 82, usage: { provider: 'claude' } })
    })
    expect(patch.status).toBe(200)
    expect(await patch.json()).toEqual({ id: ctx2Id })

    const notFound = await app.request(`/v1/ledger/step-outcomes/does-not-exist/spend`, {
      method: 'PATCH', headers: authHeaders,
      body: JSON.stringify({ spendCents: 1, usage: null })
    })
    expect(notFound.status).toBe(404)

    const cost = await app.request('/v1/ledger/runs/run_1/cost', { headers: authHeaders })
    expect(cost.status).toBe(200)
    const costBody = (await cost.json()) as RunCost
    expect(RunCostSchema.parse(costBody)).toEqual(costBody)
    expect(costBody.totalSpendCents).toBe(82)
    expect(costBody.byDispatch).toHaveLength(2)
  })

  it('assembles provenance for a repo/branch', async () => {
    const res = await app.request('/v1/ledger/provenance?repoId=r1&branch=feat/x', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ProvenanceReport
    expect(ProvenanceReportSchema.parse(body)).toEqual(body)
    expect(body.outcomes).toHaveLength(2)
    expect(body.verifications).toHaveLength(1)
    expect(body.contextCaptures[0]?.promptBytes).toBe(5)
    expect(body.totals).toEqual({ spendCents: 82, tasks: 1, dispatches: 2 })
    expect(body.reviewBackend).toEqual({ bypassed: true, enforced: false })

    const missingBranch = await app.request('/v1/ledger/provenance?repoId=r1', { headers: authHeaders })
    expect(missingBranch.status).toBe(400)
    expect(await missingBranch.json()).toEqual({ error: 'invalid_query' })
  })

  it('patches a human verdict once, updates member stats, and reports it on provenance', async () => {
    const created = await post('/v1/ledger/step-outcomes', {
      runId: 'run_3', taskId: 'task_3', dispatchId: 'ctx_9', outcome: 'succeeded',
      memberId: 'm2', projectId: 'p2', repoId: 'r3', branch: 'feat/verdict'
    })
    const { id } = (await created.json()) as { id: string }

    const patch = await app.request(`/v1/ledger/step-outcomes/${id}/human-verdict`, {
      method: 'PATCH', headers: authHeaders,
      body: JSON.stringify({ humanVerdict: 'amended', amendedAfterMs: 1500 })
    })
    expect(patch.status).toBe(200)
    expect(await patch.json()).toEqual({ id })

    const { rows: outcomeRows } = await withTenant(pool, 'local', (c) =>
      c.query(`SELECT human_verdict, amended_after_ms FROM step_outcomes WHERE id = $1`, [id])
    )
    expect(outcomeRows[0]).toEqual({ human_verdict: 'amended', amended_after_ms: 1500 })

    const { rows: statsRows } = await withTenant(pool, 'local', (c) =>
      c.query(`SELECT last_amended_at FROM member_stage_stats WHERE member_id = 'm2' AND stage_key = 'build' AND project_id = 'p2'`)
    )
    expect(statsRows[0].last_amended_at).not.toBeNull()

    const again = await app.request(`/v1/ledger/step-outcomes/${id}/human-verdict`, {
      method: 'PATCH', headers: authHeaders,
      body: JSON.stringify({ humanVerdict: 'rejected' })
    })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'verdict_already_set' })

    const notFound = await app.request(`/v1/ledger/step-outcomes/does-not-exist/human-verdict`, {
      method: 'PATCH', headers: authHeaders,
      body: JSON.stringify({ humanVerdict: 'accepted' })
    })
    expect(notFound.status).toBe(404)
    expect(await notFound.json()).toEqual({ error: 'not_found' })

    const provenance = await app.request('/v1/ledger/provenance?repoId=r3&branch=feat/verdict', { headers: authHeaders })
    const provenanceBody = (await provenance.json()) as ProvenanceReport
    expect(ProvenanceReportSchema.parse(provenanceBody)).toEqual(provenanceBody)
    expect(provenanceBody.outcomes[0]?.humanVerdict).toBe('amended')
    expect(provenanceBody.outcomes[0]?.amendedAfterMs).toBe(1500)

    const forbidden = await app.request(`/v1/ledger/step-outcomes/${id}/human-verdict`, {
      method: 'PATCH', headers: { ...authHeaders, 'x-alicorn-org': 'acme' },
      body: JSON.stringify({ humanVerdict: 'accepted' })
    })
    expect(forbidden.status).toBe(403)
  })

  it('only a correction (amended/rejected) touches last_amended_at, not an accepted verdict', async () => {
    const acceptedOutcome = await post('/v1/ledger/step-outcomes', {
      runId: 'run_4', taskId: 'task_4', dispatchId: 'ctx_10', outcome: 'succeeded',
      memberId: 'm3', projectId: 'p3', repoId: 'r4', branch: 'feat/gate'
    })
    const { id: acceptedId } = (await acceptedOutcome.json()) as { id: string }

    const acceptedPatch = await app.request(`/v1/ledger/step-outcomes/${acceptedId}/human-verdict`, {
      method: 'PATCH', headers: authHeaders,
      body: JSON.stringify({ humanVerdict: 'accepted' })
    })
    expect(acceptedPatch.status).toBe(200)

    const { rows: afterAccepted } = await withTenant(pool, 'local', (c) =>
      c.query(`SELECT last_amended_at FROM member_stage_stats WHERE member_id = 'm3' AND stage_key = 'build' AND project_id = 'p3'`)
    )
    expect(afterAccepted[0].last_amended_at).toBeNull()

    const rejectedOutcome = await post('/v1/ledger/step-outcomes', {
      runId: 'run_4', taskId: 'task_5', dispatchId: 'ctx_11', outcome: 'succeeded',
      memberId: 'm3', projectId: 'p3', repoId: 'r4', branch: 'feat/gate'
    })
    const { id: rejectedId } = (await rejectedOutcome.json()) as { id: string }

    const rejectedPatch = await app.request(`/v1/ledger/step-outcomes/${rejectedId}/human-verdict`, {
      method: 'PATCH', headers: authHeaders,
      body: JSON.stringify({ humanVerdict: 'rejected' })
    })
    expect(rejectedPatch.status).toBe(200)

    const { rows: afterRejected } = await withTenant(pool, 'local', (c) =>
      c.query(`SELECT last_amended_at FROM member_stage_stats WHERE member_id = 'm3' AND stage_key = 'build' AND project_id = 'p3'`)
    )
    expect(afterRejected[0].last_amended_at).not.toBeNull()
  })

  it('rejects malformed JSON with 400 invalid_body', async () => {
    const res = await app.request('/v1/ledger/step-outcomes', {
      method: 'POST',
      headers: authHeaders,
      body: '{not json'
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body', issues: [] })
  })

  it('rejects a mismatched org header with 403', async () => {
    const res = await app.request('/v1/ledger/provenance?repoId=r1&branch=feat/x', {
      headers: { ...authHeaders, 'x-alicorn-org': 'acme' }
    })
    expect(res.status).toBe(403)
  })

  it('keeps rows invisible outside the tenant transaction', async () => {
    const bare = await pool.query('SELECT count(*)::int AS n FROM step_outcomes')
    expect(bare.rows[0].n).toBe(0)
    const other = await withTenant(pool, 'other', (c) => c.query('SELECT count(*)::int AS n FROM step_outcomes'))
    expect(other.rows[0].n).toBe(0)
  })
})
