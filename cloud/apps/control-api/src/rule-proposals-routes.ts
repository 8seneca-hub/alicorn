import type { Hono } from 'hono'
import { z } from 'zod'
import { RULE_PROPOSAL_STATUSES, RuleProposalInputSchema, type RuleProposalStatus } from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import { acceptRuleProposal, createRuleProposal, listRuleProposalsForMember, rejectRuleProposal } from './rule-proposals-repository.js'
import { readJsonBody } from './read-json-body.js'

// Why: the rule text is written by a human in the pane's textarea, not machine-generated — bounded
// like other free-text fields on this contract (e.g. StepOutcomeInputSchema.reportSummary).
const AcceptBodySchema = z.object({ rule: z.string().trim().min(1).max(4000) })

function isRuleProposalStatus(value: string): value is RuleProposalStatus {
  return (RULE_PROPOSAL_STATUSES as readonly string[]).includes(value)
}

export function registerRuleProposalsRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  // Why no auth.actor here: this route is called by the drainer on the member's behalf, never by a
  // human — acceptance (the human action) happens only in the /accept route below.
  app.post('/v1/rule-proposals', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = RuleProposalInputSchema.safeParse(body.value)
    if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    const created = await createRuleProposal(deps.pool, auth.tenantId, result.data)
    if (created.kind === 'unknown_member') return c.json({ error: 'unknown_member' }, 400)
    return c.json({ proposal: created.proposal }, 201)
  })

  app.get('/v1/members/:id/rule-proposals', async (c) => {
    const auth = c.get('auth')
    const statusParam = c.req.query('status')
    let status: RuleProposalStatus | undefined
    if (statusParam !== undefined) {
      if (!isRuleProposalStatus(statusParam)) return c.json({ error: 'invalid_status' }, 400)
      status = statusParam
    }
    const proposals = await listRuleProposalsForMember(deps.pool, auth.tenantId, c.req.param('id'), status)
    return c.json({ proposals })
  })

  // Why auth.actor and never the body: a member can never accept its own rule — acceptance is a
  // human action, and the accepting actor must come from the authenticated request, not a payload.
  app.post('/v1/rule-proposals/:id/accept', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = AcceptBodySchema.safeParse(body.value)
    if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    const decided = await acceptRuleProposal(deps.pool, auth.tenantId, c.req.param('id'), result.data.rule, auth.actor)
    switch (decided.kind) {
      case 'ok':
        return c.json({ proposal: decided.proposal })
      case 'not_found':
        return c.json({ error: 'not_found' }, 404)
      case 'not_pending':
        return c.json({ error: 'not_pending', status: decided.status }, 409)
      case 'rules_too_long':
        return c.json({ error: 'rules_too_long' }, 409)
    }
  })

  app.post('/v1/rule-proposals/:id/reject', async (c) => {
    const auth = c.get('auth')
    const decided = await rejectRuleProposal(deps.pool, auth.tenantId, c.req.param('id'), auth.actor)
    switch (decided.kind) {
      case 'ok':
        return c.json({ proposal: decided.proposal })
      case 'not_found':
        return c.json({ error: 'not_found' }, 404)
      case 'not_pending':
        return c.json({ error: 'not_pending', status: decided.status }, 409)
    }
  })
}
