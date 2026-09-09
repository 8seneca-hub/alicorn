import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { requireTenant, type KeycloakAccessClaims } from './require-tenant.js'
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
  const keycloakConfig = {
    authMode: 'keycloak' as const,
    issuer: 'http://127.0.0.1:8080/realms/alicorn',
    internalIssuer: 'http://keycloak:8080/realms/alicorn',
    clientId: 'alicorn-desktop',
    allowInsecureJwks: false
  }
  // A token proving membership of acme (id org-1) and nothing else.
  const claims: KeycloakAccessClaims = {
    sub: 'idp-subject-1',
    azp: 'alicorn-desktop',
    exp: 2_000_000_000,
    organization: { acme: { id: 'org-1' } }
  }
  function keycloakApp() {
    const a = new Hono<ControlPlaneAuthEnv>()
    a.use('/v1/*', requireTenant({ config: keycloakConfig, verifyAccessToken: async () => claims }))
    a.get('/v1/whoami', (c) => c.json(c.get('auth')))
    return a
  }
  const authorized = { authorization: 'Bearer any-token-the-verifier-accepts' }

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

  it('refuses a header naming an organisation the token does not prove', async () => {
    // The desktop must never pair a token for one org with a header for another. If it does,
    // the tenant is the header's org nowhere -- this 403 is what makes that a bug, not a
    // silent cross-tenant read.
    const res = await keycloakApp().request('/v1/whoami', {
      headers: { ...authorized, 'x-alicorn-org': 'org-2' }
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not_a_member' })
  })

  it('refuses a token with no header at all rather than picking an organisation', async () => {
    const res = await keycloakApp().request('/v1/whoami', { headers: authorized })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'org_header_required' })
  })

  it('stamps the tenant from the header once the token proves it', async () => {
    const res = await keycloakApp().request('/v1/whoami', {
      headers: { ...authorized, 'x-alicorn-org': 'org-1' }
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenantId: 'org-1', actor: 'idp-subject-1', userId: null })
  })
})
