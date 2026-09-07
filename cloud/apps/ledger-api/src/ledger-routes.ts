import type { Hono } from 'hono'
import {
  CONTEXT_CAPTURE_MAX_PROMPT_BYTES,
  ContextCaptureInputSchema,
  HumanVerdictPatchSchema,
  InterruptionInputSchema,
  InterruptionsReportFiltersSchema,
  SpendPatchSchema,
  StepOutcomeInputSchema,
  StepVerificationInputSchema
} from '@alicorn-cloud/control-plane-contract'
import type { LedgerApiDeps, LedgerApiEnv } from './app-env.js'
import { insertStepOutcome, patchStepOutcomeHumanVerdict, patchStepOutcomeSpend } from './step-outcomes-repository.js'
import { insertStepVerification } from './step-verifications-repository.js'
import { insertContextCapture, listContextCapturesForRun } from './context-captures-repository.js'
import { getProvenance, getRunCost } from './provenance-repository.js'
import { getInterruptionsReport, insertInterruption } from './interruptions-repository.js'
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
    const captures = await listContextCapturesForRun(deps.pool, auth.tenantId, c.req.param('runId'))
    return c.json({ captures })
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
      since: c.req.query('since'),
      until: c.req.query('until')
    })
    if (!result.success) return c.json({ error: 'invalid_query' }, 400)
    const report = await getInterruptionsReport(deps.pool, auth.tenantId, result.data)
    return c.json(report)
  })
}
