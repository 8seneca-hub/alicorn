import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { requireTenant, type AuthContext } from './require-tenant.js'
import type { LedgerApiEnv } from './app-env.js'

const config = { tenantId: 'local', localApiToken: 'local-dev-token-0123456789' }
function app() {
  const a = new Hono<LedgerApiEnv>()
  a.use('/v1/*', requireTenant({ config }))
  a.get('/v1/whoami', (c) => c.json(c.get('auth')))
  return a
}
describe('requireTenant (local mode)', () => {
  it('rejects a missing or wrong bearer', async () => {
    expect((await app().request('/v1/whoami')).status).toBe(401)
    expect((await app().request('/v1/whoami', { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
  })
  it('rejects another tenant', async () => {
    const res = await app().request('/v1/whoami', { headers: { authorization: `Bearer ${config.localApiToken}`, 'x-alicorn-org': 'acme' } })
    expect(res.status).toBe(403)
  })
  it('accepts the shared token and stamps tenant + actor', async () => {
    const res = await app().request('/v1/whoami', { headers: { authorization: `Bearer ${config.localApiToken}`, 'x-alicorn-org': 'local', 'x-alicorn-actor': 'huy' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenantId: 'local', actor: 'huy' })
  })
  it('defaults the actor', async () => {
    const res = await app().request('/v1/whoami', { headers: { authorization: `Bearer ${config.localApiToken}` } })
    expect(await res.json()).toEqual({ tenantId: 'local', actor: 'local' })
  })
})
