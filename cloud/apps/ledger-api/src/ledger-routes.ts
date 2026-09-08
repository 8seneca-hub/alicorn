import type { Hono } from 'hono'
import {
  CONTEXT_CAPTURE_MAX_PROMPT_BYTES,
  ContextCaptureInputSchema,
  GateAgreementPatchSchema,
  HumanVerdictPatchSchema,
  InterruptionInputSchema,
  InterruptionsReportFiltersSchema,
  SpendPatchSchema,
  StepOutcomeInputSchema,
  StepVerificationInputSchema,
  TrackRecordQuerySchema
} from '@alicorn-cloud/control-plane-contract'
import type { LedgerApiDeps, LedgerApiEnv } from './app-env.js'
import { insertStepOutcome, patchStepOutcomeGateAgreement, patchStepOutcomeHumanVerdict, patchStepOutcomeSpend } from './step-outcomes-repository.js'
import { insertStepVerification } from './step-verifications-repository.js'
import {
  getContextCaptureForDispatch,
  insertContextCapture,
  listContextCapturesForRun
} from './context-captures-repository.js'
import { getProvenance, getRunCost } from './provenance-repository.js'
import { getInterruptionsReport, insertInterruption } from './interruptions-repository.js'
import { getTrackRecord } from './track-record-repository.js'
import { readJsonBody } from './read-json-body.js'

export function registerLedgerRoutes(app: Hono<LedgerApiEnv>, deps: LedgerApiDeps): void {
  app.post('/v1/ledger/step-outcomes', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = StepOutcomeInputSchema.safeParse(body.value)
    if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    const { id, duplicate } = await insertStepOutcome(deps.pool, auth.tenantId, result.data)
    if (duplicate) {
      deps.metrics?.incLedgerWriteDuplicate()
    } else {
      // Why: the input schema has no gate fields yet (the gates plan adds them) — read loosely so
      // this counter lights up the day they land, with no other change needed here.
      const { gateDecision, gateReason } = result.data as { gateDecision?: string; gateReason?: string }
      if (typeof gateDecision === 'string' && typeof gateReason === 'string') {
        deps.metrics?.incGateDecision(gateDecision, gateReason)
      }
    }
    return c.json({ id, duplicate }, duplicate ? 200 : 201)
  })

  app.patch('/v1/ledger/step-outcomes/:id/spend', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = SpendPatchSchema.safeParse(body.value)
    if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    const updated = await patchStepOutcomeSpend(deps.pool, auth.tenantId, c.req.param('id'), result.data)
    if (!updated) return c.json({ error: 'not_found' }, 404)
    return c.json({ id: c.req.param('id') })
  })

  app.patch('/v1/ledger/step-outcomes/:id/human-verdict', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = HumanVerdictPatchSchema.safeParse(body.value)
    if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    const id = c.req.param('id')
    const outcome = await patchStepOutcomeHumanVerdict(deps.pool, auth.tenantId, id, result.data)
    if (outcome === 'not_found') return c.json({ error: 'not_found' }, 404)
    if (outcome === 'already_set') {
      // Why: append-only — a second signal is a new event, not an overwrite; keep it visible.
      console.warn('[alicorn-ledger-api] human_verdict already set', { id, source: result.data.source })
      return c.json({ error: 'verdict_already_set' }, 409)
    }
    return c.json({ id })
  })

  // GP3 level 1: whether the human's gate decision matched what the policy would have decided.
  // A separate route from human-verdict on purpose — the two measure different things and a
  // caller that could confuse them would be writing the wrong one half the time.
  app.patch('/v1/ledger/step-outcomes/:id/gate-agreement', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = GateAgreementPatchSchema.safeParse(body.value)
    if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    const id = c.req.param('id')
    const outcome = await patchStepOutcomeGateAgreement(deps.pool, auth.tenantId, id, result.data)
    if (outcome === 'not_found') return c.json({ error: 'not_found' }, 404)
    if (outcome === 'already_set') {
      console.warn('[alicorn-ledger-api] gate agreement already recorded', { id, gateId: result.data.gateId })
      return c.json({ error: 'agreement_already_set' }, 409)
    }
    deps.metrics?.incGateAgreement(
      result.data.policyRecommendation === result.data.humanGateDecision,
      result.data.recommendationShown
    )
    return c.json({ id, agreed: result.data.policyRecommendation === result.data.humanGateDecision })
  })

  app.post('/v1/ledger/step-verifications', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = StepVerificationInputSchema.safeParse(body.value)
    if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    const { id, duplicate } = await insertStepVerification(deps.pool, auth.tenantId, result.data)
    return c.json({ id, duplicate }, duplicate ? 200 : 201)
  })

  app.post('/v1/ledger/context-captures', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    // Why: reject an oversized prompt with a distinct 413 before zod, whose max() would
    // otherwise just fold it into a generic 400 invalid_body.
    const prompt = (body.value as { prompt?: unknown })?.prompt
    if (typeof prompt === 'string' && Buffer.byteLength(prompt, 'utf8') > CONTEXT_CAPTURE_MAX_PROMPT_BYTES) {
      return c.json({ error: 'prompt_too_large' }, 413)
    }
    const result = ContextCaptureInputSchema.safeParse(body.value)
    if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    const { id, duplicate } = await insertContextCapture(deps.pool, auth.tenantId, result.data)
    return c.json({ id, duplicate }, duplicate ? 200 : 201)
  })

  app.get('/v1/ledger/provenance', async (c) => {
    const auth = c.get('auth')
    const repoId = c.req.query('repoId')
    const branch = c.req.query('branch')
    if (!repoId || !branch) return c.json({ error: 'invalid_query' }, 400)
    const report = await getProvenance(deps.pool, auth.tenantId, { repoId, branch })
    return c.json(report)
  })

  app.get('/v1/ledger/runs/:runId/context-captures', async (c) => {
    const auth = c.get('auth')
    return c.json(await listContextCapturesForRun(deps.pool, auth.tenantId, c.req.param('runId')))
  })

  // Why not the list route filtered client-side: the inspector's list read keeps metadata only, so
  // opening one prompt must not re-read every capture in the run — and a capture past the list cap
  // is still reachable by id.
  app.get('/v1/ledger/runs/:runId/context-captures/:dispatchId', async (c) => {
    const auth = c.get('auth')
    const capture = await getContextCaptureForDispatch(
      deps.pool,
      auth.tenantId,
      c.req.param('runId'),
      c.req.param('dispatchId')
    )
    if (!capture) return c.json({ error: 'not_found' }, 404)
    return c.json(capture)
  })

  app.get('/v1/ledger/runs/:runId/cost', async (c) => {
    const auth = c.get('auth')
    const cost = await getRunCost(deps.pool, auth.tenantId, c.req.param('runId'))
    return c.json(cost)
  })

  app.post('/v1/ledger/interruptions', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = InterruptionInputSchema.safeParse(body.value)
    if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    const { id, duplicate } = await insertInterruption(deps.pool, auth.tenantId, result.data)
    return c.json({ id, duplicate }, duplicate ? 200 : 201)
  })

  app.get('/v1/ledger/reports/interruptions', async (c) => {
    const auth = c.get('auth')
    const result = InterruptionsReportFiltersSchema.safeParse({
      stageKey: c.req.query('stageKey'),
      projectId: c.req.query('projectId'),
      memberId: c.req.query('memberId'),
      runId: c.req.query('runId'),
      executionStrategy: c.req.query('executionStrategy'),
      since: c.req.query('since'),
      until: c.req.query('until')
    })
    if (!result.success) return c.json({ error: 'invalid_query' }, 400)
    const report = await getInterruptionsReport(deps.pool, auth.tenantId, result.data)
    return c.json(report)
  })

  // GP2: the windowed track record `evaluateGate` reads as `evidence.stats`. Named track-record,
  // not evidence: `GateEvidence` is a wider shape (checks, blast radius) assembled on the client,
  // and one word for two shapes is how the two drift apart.
  app.get('/v1/ledger/track-record', async (c) => {
    const auth = c.get('auth')
    const query = TrackRecordQuerySchema.safeParse({
      memberId: c.req.query('memberId'),
      stageKey: c.req.query('stageKey') ?? undefined,
      projectId: c.req.query('projectId')
    })
    if (!query.success) return c.json({ error: 'invalid_query' }, 400)
    return c.json(await getTrackRecord(deps.pool, auth.tenantId, query.data))
  })
}
