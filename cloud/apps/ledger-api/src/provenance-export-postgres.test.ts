import { generateKeyPairSync } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import {
  applySchema,
  createTestSchema,
  dropTestSchema,
  openControlPlanePool
} from '@alicorn-cloud/control-plane-postgres'
import {
  ProvenanceExportEnvelopeSchema,
  StepOutcomeInputSchema,
  readProvenanceExportSigningKey,
  readSignedProvenanceMarkdownJws,
  verificationKeyFromJwk,
  verifyProvenanceExport,
  verifyProvenanceExportCompactJws,
  type ProvenanceExportEnvelope
} from '@alicorn-cloud/control-plane-contract'
import { createLedgerApiApp } from './app.js'
import { loadLedgerApiConfig } from './config.js'
import type { LedgerApiEnv } from './app-env.js'
import { LEDGER_SCHEMA_STATEMENTS } from './schema-sql.js'
import { insertStepOutcome } from './step-outcomes-repository.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'provenance_export_test'

describePostgres('provenance export (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<LedgerApiEnv>

  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const signingKey = readProvenanceExportSigningKey(
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    { keyId: 'export-test-key' }
  )
  const verificationKeys = [verificationKeyFromJwk(signingKey.publicJwk)]

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'content-type': 'application/json'
  }

  function post(path: string, body: unknown) {
    return app.request(path, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) })
  }

  async function exportJson(): Promise<ProvenanceExportEnvelope> {
    const res = await app.request(
      '/v1/ledger/provenance/export?repoId=r_export&branch=feat/export',
      { headers: authHeaders }
    )
    expect(res.status).toBe(200)
    return ProvenanceExportEnvelopeSchema.parse(await res.json()) as ProvenanceExportEnvelope
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({
      databaseUrl: appUrl,
      schema,
      applicationName: 'ledger-api-provenance-export-test'
    })
    await applySchema(pool, LEDGER_SCHEMA_STATEMENTS)
    const config = loadLedgerApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789',
      ALICORN_TENANT_ID: 'local'
    })
    app = createLedgerApiApp({ config, pool, exportSigningKey: signingKey })

    const build = await post('/v1/ledger/step-outcomes', {
      runId: 'run_export', taskId: 'task_export', dispatchId: 'disp_build', outcome: 'succeeded',
      memberId: 'm_dev', projectId: 'p1', repoId: 'r_export', branch: 'feat/export',
      stageKey: 'build', backend: 'claude', filesModified: ['a.ts', 'b.ts'],
      reportSummary: 'built the thing\nand said more'
    })
    const buildId = ((await build.json()) as { id: string }).id
    await app.request(`/v1/ledger/step-outcomes/${buildId}/spend`, {
      method: 'PATCH', headers: authHeaders, body: JSON.stringify({ spendCents: 140, usage: null })
    })
    await app.request(`/v1/ledger/step-outcomes/${buildId}/gate-agreement`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        gateId: 'gate_build', policyRecommendation: 'gate', policyRecommendationReason: 'irreversible',
        humanGateDecision: 'auto', recommendationShown: true
      })
    })
    await post('/v1/ledger/step-outcomes', {
      runId: 'run_export', taskId: 'task_export', dispatchId: 'disp_review', outcome: 'succeeded',
      memberId: 'm_rev', projectId: 'p1', repoId: 'r_export', branch: 'feat/export',
      stageKey: 'review', backend: 'codex', filesModified: []
    })
    await post('/v1/ledger/step-verifications', {
      runId: 'run_export', taskId: 'task_export', dispatchId: 'disp_build',
      kind: 'diff_coverage', name: 'Diff coverage ≥ 80%', required: true, status: 'passed',
      detail: { ratio: 0.91 }
    })

    // Why the repository directly: local auth mode only ever authenticates as tenant 'local', so
    // this is the only way to plant another tenant's step on the very same repo and branch.
    await insertStepOutcome(pool, 'other-tenant', StepOutcomeInputSchema.parse({
      runId: 'run_other', taskId: 'task_other', dispatchId: 'disp_other', outcome: 'failed',
      memberId: 'm_other', repoId: 'r_export', branch: 'feat/export', stageKey: 'secret-stage',
      backend: 'claude', reportSummary: 'not yours'
    }))
  })

  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  it('signs a document a verifier accepts, keyed by the published JWKS', async () => {
    const envelope = await exportJson()
    const jwks = (await (await app.request('/.well-known/alicorn-provenance-jwks.json')).json()) as {
      keys: { kid: string }[]
    }
    expect(envelope.signature.keyId).toBe(jwks.keys[0]?.kid)
    expect(verifyProvenanceExport(envelope.document, envelope.signature, verificationKeys)).toEqual({
      ok: true,
      keyId: 'export-test-key'
    })
  })

  it('carries the whole decision trail: steps, checks, gate decisions and the agreement', async () => {
    const { document } = await exportJson()
    expect(document.view.steps.map((step) => step.stageKey)).toEqual(['build', 'review'])
    expect(document.view.totals).toEqual({ tasks: 1, dispatches: 2, spendCents: 140 })
    expect(document.view.checks[0]).toMatchObject({ name: 'Diff coverage ≥ 80%', ratio: 0.91, required: true })
    const build = document.view.steps.find((step) => step.stageKey === 'build')
    expect(build?.gate.gateId).toBe('gate_build')
    expect(build?.gate.agreement).toEqual({
      recorded: true,
      policyRecommendation: 'gate',
      policyRecommendationReason: 'irreversible',
      humanGateDecision: 'auto',
      agreed: false,
      recommendationShown: true
    })
    expect(document.view.agreementCounts).toEqual({ agreed: 0, disagreed: 1, unrecorded: 1 })
    expect(document.markdown).toContain('overrode the policy; recommendation shown.')
  })

  it('never crosses a tenant boundary, even for the same repo and branch', async () => {
    const { document } = await exportJson()
    expect(document.tenantId).toBe('local')
    const serialised = JSON.stringify(document)
    expect(serialised).not.toContain('other-tenant')
    expect(serialised).not.toContain('secret-stage')
    expect(serialised).not.toContain('not yours')
    expect(document.view.steps).toHaveLength(2)
  })

  it('dates itself from the server clock, not from any client timestamp', async () => {
    const before = Date.now()
    const { document } = await exportJson()
    const at = Date.parse(document.exportedAt)
    expect(at).toBeGreaterThanOrEqual(before - 1000)
    expect(at).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('reports that retention is not wired rather than implying the export was kept', async () => {
    const { archive } = await exportJson()
    expect(archive).toEqual({ stored: false, reason: 'not_configured' })
  })

  it('fails verification when a single byte of the exported document changes', async () => {
    const envelope = await exportJson()
    const oneByte = {
      ...envelope.document,
      markdown: `${envelope.document.markdown} `
    }
    expect(verifyProvenanceExport(oneByte, envelope.signature, verificationKeys)).toEqual({
      ok: false,
      reason: 'bad_signature'
    })
    // And a spend edited by one cent, which is the change an auditor most cares about.
    const oneCent = {
      ...envelope.document,
      view: {
        ...envelope.document.view,
        totals: { ...envelope.document.view.totals, spendCents: 141 }
      }
    }
    expect(verifyProvenanceExport(oneCent, envelope.signature, verificationKeys).ok).toBe(false)
  })

  it('serves a Markdown export that verifies on its own', async () => {
    const res = await app.request(
      '/v1/ledger/provenance/export?repoId=r_export&branch=feat/export&format=md',
      { headers: authHeaders }
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(res.headers.get('x-alicorn-export-key-id')).toBe('export-test-key')
    expect(res.headers.get('x-alicorn-export-archived')).toBe('no:not_configured')

    const markdown = await res.text()
    expect(markdown).toContain('<!-- alicorn:provenance:start -->')
    const jws = readSignedProvenanceMarkdownJws(markdown)
    expect(jws).not.toBeNull()
    const verified = verifyProvenanceExportCompactJws(jws!, verificationKeys)
    expect(verified.ok).toBe(true)

    // The prose above the footer is exactly the Markdown inside the signed bytes.
    const inside = (verified.ok ? verified.document : null) as { markdown: string } | null
    expect(markdown.startsWith(inside!.markdown)).toBe(true)

    const tampered = markdown.replace('Diff coverage ≥ 80%', 'Diff coverage ≥ 10%')
    const tamperedJws = readSignedProvenanceMarkdownJws(tampered)!
    // Editing the prose alone leaves the signature intact — which is why the footer, not the
    // prose, is the evidence, and why a verifier compares the two.
    expect(verifyProvenanceExportCompactJws(tamperedJws, verificationKeys).ok).toBe(true)
    const stillInside = verifyProvenanceExportCompactJws(tamperedJws, verificationKeys)
    expect(tampered.startsWith((stillInside as { document: { markdown: string } }).document.markdown)).toBe(false)
  })

  it('accepts format=markdown as an alias for md', async () => {
    const res = await app.request(
      '/v1/ledger/provenance/export?repoId=r_export&branch=feat/export&format=markdown',
      { headers: authHeaders }
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
  })

  it('exports an empty branch as a document with no steps, not as an error', async () => {
    const res = await app.request(
      '/v1/ledger/provenance/export?repoId=r_export&branch=never-ran',
      { headers: authHeaders }
    )
    expect(res.status).toBe(200)
    const envelope = ProvenanceExportEnvelopeSchema.parse(await res.json()) as ProvenanceExportEnvelope
    expect(envelope.document.view.steps).toEqual([])
    expect(envelope.document.markdown).toBe('')
    expect(verifyProvenanceExport(envelope.document, envelope.signature, verificationKeys).ok).toBe(true)
  })
})
