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
import type { Member, RuleProposal } from '@alicorn-cloud/control-plane-contract'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import type { ControlApiEnv } from './app-env.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_rule_proposals_test'

describePostgres('rule proposal routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>
  let memberId: string

  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'x-alicorn-actor': 'huy'
  }
  const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' }

  async function createMember(name: string): Promise<string> {
    const res = await app.request('/v1/members', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name,
        role: 'developer',
        backend: 'claude',
        workspaceKind: 'worktree',
        permissionMode: 'ask'
      })
    })
    const { member } = (await res.json()) as { member: Member }
    return member.id
  }

  async function proposeRule(overrides: Partial<{ memberId: string; outcomeId: string; verdict: string; context: unknown }> = {}) {
    return app.request('/v1/rule-proposals', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        memberId,
        outcomeId: 'outcome_1',
        verdict: 'amended',
        context: { sha: 'abc123', files: ['a.ts'], excerpt: 'diff excerpt' },
        ...overrides
      })
    })
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-rule-proposals-test' })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    const config = loadControlApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789',
      ALICORN_TENANT_ID: 'local'
    })
    app = createControlApiApp({ config, pool })
    memberId = await createMember('Builder')
  })

  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  it('creates a pending proposal from the drainer', async () => {
    const res = await proposeRule()
    expect(res.status).toBe(201)
    const { proposal } = (await res.json()) as { proposal: RuleProposal }
    expect(proposal.memberId).toBe(memberId)
    expect(proposal.status).toBe('pending')
    expect(proposal.proposedRule).toBeNull()
    expect(proposal.context).toEqual({ sha: 'abc123', files: ['a.ts'], excerpt: 'diff excerpt' })
  })

  it('is idempotent on outcome_id — a retried post returns the existing proposal, not a second row', async () => {
    const first = await proposeRule()
    const { proposal: firstProposal } = (await first.json()) as { proposal: RuleProposal }

    const retry = await proposeRule({ context: { sha: 'different-on-retry' } })
    expect(retry.status).toBe(201)
    const { proposal: retryProposal } = (await retry.json()) as { proposal: RuleProposal }
    expect(retryProposal.id).toBe(firstProposal.id)

    const list = await app.request(`/v1/members/${memberId}/rule-proposals`, { headers: authHeaders })
    const { proposals } = (await list.json()) as { proposals: RuleProposal[] }
    expect(proposals.filter((p) => p.outcomeId === 'outcome_1')).toHaveLength(1)
  })

  it('rejects a proposal for a member outside the tenant with 400', async () => {
    const res = await proposeRule({ memberId: 'not-a-real-member', outcomeId: 'outcome_unknown_member' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unknown_member' })
  })

  it('rejects an invalid verdict with 400', async () => {
    const res = await proposeRule({ verdict: 'nope', outcomeId: 'outcome_bad_verdict' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_body')
  })

  it('lists only pending proposals when filtered', async () => {
    const res = await app.request(`/v1/members/${memberId}/rule-proposals?status=pending`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const { proposals } = (await res.json()) as { proposals: RuleProposal[] }
    expect(proposals.every((p) => p.status === 'pending')).toBe(true)
    expect(proposals.some((p) => p.outcomeId === 'outcome_1')).toBe(true)
  })

  it('rejects an unknown status filter with 400', async () => {
    const res = await app.request(`/v1/members/${memberId}/rule-proposals?status=bogus`, { headers: authHeaders })
    expect(res.status).toBe(400)
  })

  it('accepts a proposal, appends the rule to the member and stamps decidedBy from the auth actor, never the body', async () => {
    const created = await proposeRule({ outcomeId: 'outcome_accept' })
    const { proposal } = (await created.json()) as { proposal: RuleProposal }

    const res = await app.request(`/v1/rule-proposals/${proposal.id}/accept`, {
      method: 'POST',
      headers: jsonHeaders,
      // decidedBy is not part of the accept schema — an attempt to smuggle it in the body must be ignored.
      body: JSON.stringify({ rule: 'Always run lint before committing.', decidedBy: 'someone-else' })
    })
    expect(res.status).toBe(200)
    const { proposal: accepted } = (await res.json()) as { proposal: RuleProposal }
    expect(accepted.status).toBe('accepted')
    expect(accepted.proposedRule).toBe('Always run lint before committing.')
    expect(accepted.decidedBy).toBe('huy')
    expect(accepted.decidedAt).not.toBeNull()

    const memberRes = await app.request(`/v1/members/${memberId}`, { headers: authHeaders })
    const { member } = (await memberRes.json()) as { member: Member }
    expect(member.systemRules).toContain('Always run lint before committing.')
    expect(member.systemRules).toContain(`<!-- rule:${proposal.id} -->`)
  })

  it('rejects accepting an already-decided proposal with 409', async () => {
    const created = await proposeRule({ outcomeId: 'outcome_double_accept' })
    const { proposal } = (await created.json()) as { proposal: RuleProposal }
    await app.request(`/v1/rule-proposals/${proposal.id}/accept`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ rule: 'First rule.' })
    })
    const second = await app.request(`/v1/rule-proposals/${proposal.id}/accept`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ rule: 'Second rule.' })
    })
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'not_pending', status: 'accepted' })
  })

  it('returns 404 accepting an unknown proposal', async () => {
    const res = await app.request('/v1/rule-proposals/not-a-real-id/accept', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ rule: 'x' })
    })
    expect(res.status).toBe(404)
  })

  it('rejects a proposal, leaving the member rules untouched', async () => {
    const created = await proposeRule({ outcomeId: 'outcome_reject' })
    const { proposal } = (await created.json()) as { proposal: RuleProposal }
    const before = await app.request(`/v1/members/${memberId}`, { headers: authHeaders })
    const { member: memberBefore } = (await before.json()) as { member: Member }

    const res = await app.request(`/v1/rule-proposals/${proposal.id}/reject`, { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(200)
    const { proposal: rejected } = (await res.json()) as { proposal: RuleProposal }
    expect(rejected.status).toBe('rejected')
    expect(rejected.decidedBy).toBe('huy')

    const after = await app.request(`/v1/members/${memberId}`, { headers: authHeaders })
    const { member: memberAfter } = (await after.json()) as { member: Member }
    expect(memberAfter.systemRules).toBe(memberBefore.systemRules)
  })

  it('rejects rejecting an already-decided proposal with 409', async () => {
    const created = await proposeRule({ outcomeId: 'outcome_double_reject' })
    const { proposal } = (await created.json()) as { proposal: RuleProposal }
    await app.request(`/v1/rule-proposals/${proposal.id}/reject`, { method: 'POST', headers: authHeaders })
    const second = await app.request(`/v1/rule-proposals/${proposal.id}/reject`, { method: 'POST', headers: authHeaders })
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'not_pending', status: 'rejected' })
  })

  it('refuses to append past the 20,000-character cap, leaving the member and the proposal unchanged', async () => {
    const capMemberId = await createMember('Near Cap')
    const nearCapRules = 'x'.repeat(20_000)
    const putRes = await app.request(`/v1/members/${capMemberId}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'Near Cap',
        role: 'developer',
        backend: 'claude',
        workspaceKind: 'worktree',
        permissionMode: 'ask',
        systemRules: nearCapRules
      })
    })
    expect(putRes.status).toBe(200)

    const created = await proposeRule({ memberId: capMemberId, outcomeId: 'outcome_too_long' })
    const { proposal } = (await created.json()) as { proposal: RuleProposal }

    const res = await app.request(`/v1/rule-proposals/${proposal.id}/accept`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ rule: 'One more rule that would push past the cap.' })
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'rules_too_long' })

    const memberRes = await app.request(`/v1/members/${capMemberId}`, { headers: authHeaders })
    const { member } = (await memberRes.json()) as { member: Member }
    expect(member.systemRules).toBe(nearCapRules)

    const listRes = await app.request(`/v1/members/${capMemberId}/rule-proposals?status=pending`, { headers: authHeaders })
    const { proposals } = (await listRes.json()) as { proposals: RuleProposal[] }
    expect(proposals.map((p) => p.id)).toContain(proposal.id)
  })

  it('enforces RLS at the database level, not just in application queries', async () => {
    const other = await withTenant(pool, 'other-tenant', (c) => c.query('SELECT count(*)::int AS n FROM rule_proposals'))
    expect(other.rows[0].n).toBe(0)
    const mine = await withTenant(pool, 'local', (c) => c.query('SELECT count(*)::int AS n FROM rule_proposals'))
    expect(mine.rows[0].n).toBeGreaterThan(0)
  })
})
