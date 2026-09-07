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
import { ContextCaptureListSchema, InterruptionsReportSchema, ProvenanceReportSchema, RunCostSchema } from '@alicorn-cloud/control-plane-contract'
import type { ContextCaptureRead, InterruptionsReport, ProvenanceReport, RunCost } from '@alicorn-cloud/control-plane-contract'
import { createLedgerApiApp } from './app.js'
import { loadLedgerApiConfig } from './config.js'
import type { LedgerApiEnv } from './app-env.js'
import { LEDGER_SCHEMA_STATEMENTS } from './schema-sql.js'
import { _resetAmendedWithinWindowCacheForTests } from './ledger-metrics.js'
import { patchStepOutcomeHumanVerdict } from './step-outcomes-repository.js'
import { insertContextCapture } from './context-captures-repository.js'

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

  it('reads a run\'s context captures back oldest first, distinguishing an inline prompt from one spilled to a file', async () => {
    // Why dispatch ids sort opposite of insertion order: proves the route orders by created_at,
    // not by accidentally sorting on the tiebreaker column.
    const inline = await post('/v1/ledger/context-captures', {
      runId: 'run_ctx_read', taskId: 'task_ctx_read', dispatchId: 'zz_inline_capture',
      prompt: 'the exact prompt a member saw', contextSlice: { taskSpec: 'x' }
    })
    expect(inline.status).toBe(201)

    const spilled = await post('/v1/ledger/context-captures', {
      runId: 'run_ctx_read', taskId: 'task_ctx_read', dispatchId: 'aa_spilled_capture',
      promptPath: '/var/alicorn/prompts/task_ctx_read.txt'
    })
    expect(spilled.status).toBe(201)

    // Why call the repository directly: local auth mode only ever authenticates as tenant
    // 'local', so this is the only way to plant a row for a second tenant and prove RLS hides it.
    await insertContextCapture(pool, 'other-tenant', {
      runId: 'run_ctx_read', taskId: 'task_ctx_read', dispatchId: 'ctx_other_tenant', prompt: 'not yours', contextSlice: {}
    })

    const res = await app.request('/v1/ledger/runs/run_ctx_read/context-captures', { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { captures: ContextCaptureRead[] }
    expect(ContextCaptureListSchema.parse(body)).toEqual(body)
    expect(body.captures).toHaveLength(2)

    expect(body.captures[0]).toMatchObject({
      dispatchId: 'zz_inline_capture', prompt: 'the exact prompt a member saw', promptPath: null
    })
    expect(body.captures[1]).toMatchObject({
      dispatchId: 'aa_spilled_capture', prompt: null, promptPath: '/var/alicorn/prompts/task_ctx_read.txt'
    })
  })

  it('returns an empty array for a run with no captures, not a 404', async () => {
    const res = await app.request('/v1/ledger/runs/run_does_not_exist/context-captures', { headers: authHeaders })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ captures: [] })
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

  it('scopes a human-verdict patch to its own tenant — another tenant gets not_found, never a conflict', async () => {
    const created = await post('/v1/ledger/step-outcomes', {
      runId: 'run_6', taskId: 'task_6', dispatchId: 'ctx_12', outcome: 'succeeded'
    })
    const { id } = (await created.json()) as { id: string }

    // Why: local auth mode only ever authenticates as tenant 'local' — calling the repository
    // directly is the only way to exercise RLS from a second tenant's point of view.
    const outcome = await patchStepOutcomeHumanVerdict(pool, 'other-tenant', id, {
      humanVerdict: 'accepted', amendedAfterMs: null, source: 'manual'
    })
    expect(outcome).toBe('not_found')
  })

  it('inserts all three interruption kinds and is exactly-once on (kind, sourceId)', async () => {
    const gate = await post('/v1/ledger/interruptions', {
      runId: 'run_7', taskId: 'task_7', dispatchId: 'ctx_13',
      kind: 'gate', sourceId: 'gate_1', occurredAt: '2026-09-06T00:00:00.000Z'
    })
    expect(gate.status).toBe(201)
    const gateBody = (await gate.json()) as { id: string; duplicate: boolean }
    expect(gateBody.duplicate).toBe(false)

    const ask = await post('/v1/ledger/interruptions', {
      runId: 'run_7', taskId: 'task_7', dispatchId: 'ctx_13',
      kind: 'ask', sourceId: 'ask_1', occurredAt: '2026-09-06T00:01:00.000Z'
    })
    expect(ask.status).toBe(201)

    const escalation = await post('/v1/ledger/interruptions', {
      runId: 'run_7', taskId: 'task_7', dispatchId: 'ctx_13',
      kind: 'escalation', sourceId: 'ctx_13', occurredAt: '2026-09-06T00:02:00.000Z'
    })
    expect(escalation.status).toBe(201)

    const duplicate = await post('/v1/ledger/interruptions', {
      runId: 'run_7', taskId: 'task_7', dispatchId: 'ctx_13',
      kind: 'gate', sourceId: 'gate_1', occurredAt: '2026-09-06T00:03:00.000Z'
    })
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toEqual({ id: gateBody.id, duplicate: true })
  })

  it('reports interruptions per completed task, grouped by kind and stage, and narrows with filters', async () => {
    await post('/v1/ledger/step-outcomes', {
      runId: 'run_8', taskId: 'task_8a', dispatchId: 'ctx_14', outcome: 'succeeded',
      projectId: 'p10', memberId: 'mA', stageKey: 'build'
    })
    await post('/v1/ledger/step-outcomes', {
      runId: 'run_8', taskId: 'task_8b', dispatchId: 'ctx_15', outcome: 'succeeded',
      projectId: 'p10', memberId: 'mB', stageKey: 'review'
    })

    await post('/v1/ledger/interruptions', {
      runId: 'run_8', taskId: 'task_8a', dispatchId: 'ctx_14',
      kind: 'gate', sourceId: 'gate_8a', occurredAt: '2026-09-06T01:00:00.000Z'
    })
    await post('/v1/ledger/interruptions', {
      runId: 'run_8', taskId: 'task_8a', dispatchId: 'ctx_14',
      kind: 'ask', sourceId: 'ask_8a', occurredAt: '2026-09-06T01:01:00.000Z'
    })
    await post('/v1/ledger/interruptions', {
      runId: 'run_8', taskId: 'task_8b', dispatchId: 'ctx_15',
      kind: 'escalation', sourceId: 'esc_8b', occurredAt: '2026-09-06T01:02:00.000Z'
    })

    const res = await app.request('/v1/ledger/reports/interruptions?projectId=p10', { headers: authHeaders })
    expect(res.status).toBe(200)
    const report = (await res.json()) as InterruptionsReport
    expect(InterruptionsReportSchema.parse(report)).toEqual(report)
    expect(report.completedTasks).toBe(2)
    expect(report.interruptions).toBe(3)
    expect(report.perCompletedTask).toBe(1.5)
    expect(report.byKind).toEqual({ gate: 1, ask: 1, escalation: 1 })
    expect(report.byStage).toEqual([
      { stageKey: 'build', completedTasks: 1, interruptions: 2, perCompletedTask: 2 },
      { stageKey: 'review', completedTasks: 1, interruptions: 1, perCompletedTask: 1 }
    ])
    expect(report.excluded).toEqual(['permission_prompt'])

    const narrowed = await app.request('/v1/ledger/reports/interruptions?projectId=p10&stageKey=build', { headers: authHeaders })
    const narrowedReport = (await narrowed.json()) as InterruptionsReport
    expect(narrowedReport.completedTasks).toBe(1)
    expect(narrowedReport.interruptions).toBe(2)
    expect(narrowedReport.perCompletedTask).toBe(2)
    expect(narrowedReport.byKind).toEqual({ gate: 1, ask: 1 })

    // Why: `since` in the future excludes every row — the zero-denominator rule reports 0, not NaN.
    const future = await app.request(
      `/v1/ledger/reports/interruptions?projectId=p10&since=${encodeURIComponent('2099-01-01T00:00:00.000Z')}`,
      { headers: authHeaders }
    )
    const futureReport = (await future.json()) as InterruptionsReport
    expect(futureReport).toEqual({
      filters: { projectId: 'p10', since: '2099-01-01T00:00:00.000Z' },
      completedTasks: 0, interruptions: 0, perCompletedTask: 0,
      byKind: {}, byStage: [], excluded: ['permission_prompt']
    })

    const malformed = await app.request('/v1/ledger/reports/interruptions?since=not-a-date', { headers: authHeaders })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'invalid_query' })
  })

  it('does not inflate interruptions when one dispatch spans two step_outcomes rows', async () => {
    // Why two rows: v1.5 stages can let one dispatch span two step_outcomes rows (same
    // task_id/dispatch_id, different stage_key -- the unique key already permits this today).
    // One interruption then joins both, and COUNT(*) over the join would double-count it (item 14).
    await post('/v1/ledger/step-outcomes', {
      runId: 'run_9', taskId: 'task_9', dispatchId: 'ctx_16', outcome: 'succeeded',
      projectId: 'p11', memberId: 'mC', stageKey: 'build'
    })
    await post('/v1/ledger/step-outcomes', {
      runId: 'run_9', taskId: 'task_9', dispatchId: 'ctx_16', outcome: 'succeeded',
      projectId: 'p11', memberId: 'mC', stageKey: 'review'
    })
    await post('/v1/ledger/interruptions', {
      runId: 'run_9', taskId: 'task_9', dispatchId: 'ctx_16',
      kind: 'gate', sourceId: 'gate_9', occurredAt: '2026-09-06T02:00:00.000Z'
    })

    const res = await app.request('/v1/ledger/reports/interruptions?projectId=p11', { headers: authHeaders })
    const report = (await res.json()) as InterruptionsReport
    expect(report.completedTasks).toBe(1)
    expect(report.interruptions).toBe(1)
    expect(report.byKind).toEqual({ gate: 1 })
    expect(report.byStage).toEqual([
      { stageKey: 'build', completedTasks: 1, interruptions: 1, perCompletedTask: 1 },
      { stageKey: 'review', completedTasks: 1, interruptions: 1, perCompletedTask: 1 }
    ])
  })

  it('keeps step_interruptions invisible outside the tenant transaction', async () => {
    const bare = await pool.query('SELECT count(*)::int AS n FROM step_interruptions')
    expect(bare.rows[0].n).toBe(0)
    const other = await withTenant(pool, 'other', (c) => c.query('SELECT count(*)::int AS n FROM step_interruptions'))
    expect(other.rows[0].n).toBe(0)
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

describePostgres('ledger metrics (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<LedgerApiEnv>

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'content-type': 'application/json'
  }

  function post(path: string, body: unknown) {
    return app.request(path, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) })
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, 'ledger_metrics_test')
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema: 'ledger_metrics_test', applicationName: 'ledger-api-metrics-test' })
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
    await dropTestSchema(databaseUrl!, 'ledger_metrics_test')
  })

  it('counts a duplicate write, never a gate decision the request never carried, then folds in an amended verdict', async () => {
    const body = { runId: 'run_m1', taskId: 'task_m1', dispatchId: 'ctx_m1', outcome: 'succeeded' }
    const first = await post('/v1/ledger/step-outcomes', body)
    expect(first.status).toBe(201)
    const { id } = (await first.json()) as { id: string }

    // Why: identical delivery — exercises the exactly-once path that ledger_write_duplicates_total counts.
    const second = await post('/v1/ledger/step-outcomes', body)
    expect(second.status).toBe(200)

    const afterWrites = await app.request('/metrics')
    expect(afterWrites.status).toBe(200)
    const afterWritesText = await afterWrites.text()
    expect(afterWritesText).toContain('ledger_write_duplicates_total 1')
    // Why: the input schema has no gate fields yet — a plain outcome post never carries one, so the
    // series must stay absent rather than climb off the step_outcomes column defaults.
    expect(afterWritesText).not.toContain('gate_decisions_total{')

    const patch = await app.request(`/v1/ledger/step-outcomes/${id}/human-verdict`, {
      method: 'PATCH', headers: authHeaders,
      body: JSON.stringify({ humanVerdict: 'amended', amendedAfterMs: 500 })
    })
    expect(patch.status).toBe(200)

    // Why: /metrics now caches the gauge for 30s (item 6) -- force a fresh query here since this
    // test is about the query reflecting the new verdict, not about the cache window.
    _resetAmendedWithinWindowCacheForTests()
    const afterVerdict = await app.request('/metrics')
    const afterVerdictText = await afterVerdict.text()
    expect(afterVerdictText).toContain('amended_within_window 1')
  })
})
