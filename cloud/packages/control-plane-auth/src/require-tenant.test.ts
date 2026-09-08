import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { requireTenant } from './require-tenant.js'
import type { ControlPlaneAuthEnv } from './auth-context.js'

const config = { authMode: 'local' as const, tenantId: 'local', localApiToken: 'local-dev-token-0123456789' }
function app() {
  const a = new Hono<ControlPlaneAuthEnv>()
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
  it('accepts the shared token and stamps tenant + actor + userId', async () => {
    const res = await app().request('/v1/whoami', { headers: { authorization: `Bearer ${config.localApiToken}`, 'x-alicorn-org': 'local', 'x-alicorn-actor': 'huy' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenantId: 'local', actor: 'huy', userId: null })
  })
  it('defaults the actor', async () => {
    const res = await app().request('/v1/whoami', { headers: { authorization: `Bearer ${config.localApiToken}` } })
    expect(await res.json()).toEqual({ tenantId: 'local', actor: 'local', userId: null })
  })
})

describe('requireTenant (keycloak mode)', () => {
  // Why: this fail-fast is the only thing stopping a keycloak-configured deployment from
  // accepting unverified traffic, and a regression here keeps build and typecheck green.
  // The placeholder this replaces asserted 'not implemented'; the verifier has landed, so the
  // fail-closed case is now a keycloak config constructed without one.
  it('refuses to construct without a token verifier', () => {
    expect(() =>
      requireTenant({
        config: {
          authMode: 'keycloak',
          issuer: 'http://127.0.0.1:8080/realms/alicorn',
          internalIssuer: 'http://keycloak:8080/realms/alicorn',
          clientId: 'alicorn-desktop',
          allowInsecureJwks: false
        }
      })
    ).toThrow('verifyAccessToken required in keycloak mode')
  })
})
