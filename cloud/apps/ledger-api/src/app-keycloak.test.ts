import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKeycloakVerifiers,
  startTestKeycloakServer,
  type TestKeycloakServer
} from '@alicorn-cloud/control-plane-auth'
import { createLedgerApiApp } from './app.js'
import { loadLedgerApiConfig } from './config.js'

const CLIENT_ID = 'alicorn-desktop'
let server: TestKeycloakServer

beforeAll(async () => {
  server = await startTestKeycloakServer({ clientId: CLIENT_ID })
})
afterAll(async () => {
  await server.close()
})

function keycloakApp(): ReturnType<typeof createLedgerApiApp> {
  const config = loadLedgerApiConfig({
    ALICORN_DATABASE_URL: 'postgres://x',
    ALICORN_AUTH_MODE: 'keycloak',
    ALICORN_KEYCLOAK_ISSUER: server.issuer,
    ALICORN_DESKTOP_CLIENT_ID: CLIENT_ID
  })
  if (config.auth.authMode !== 'keycloak') throw new Error('expected keycloak mode')
  const app = createLedgerApiApp({
    config,
    pool: {} as never,
    verifyAccessToken: createKeycloakVerifiers(config.auth).verifyAccessToken
  })
  app.get('/v1/probe', (c) => c.json(c.get('auth')))
  return app
}

function accessToken(claims: Record<string, unknown> = {}): Promise<string> {
  return server.keycloak.sign({
    sub: 'kc-sub-1',
    azp: CLIENT_ID,
    typ: 'Bearer',
    organization: { acme: { id: 'org-acme' } },
    ...claims
  })
}

// The ledger API has no identity tables of its own, so this is the whole of keycloak mode for it:
// a verified token plus the organisation header that selects which proven organisation to act as.
describe('ledger-api in keycloak mode', () => {
  it('takes the tenant from the token, with the header only selecting among proven organisations', async () => {
    const app = keycloakApp()
    const headers = { authorization: `Bearer ${await accessToken()}` }
    expect((await app.request('/v1/probe', { headers })).status).toBe(400)
    expect((await app.request('/v1/probe', { headers: { ...headers, 'x-alicorn-org': 'org-zzz' } })).status).toBe(403)

    const ok = await app.request('/v1/probe', { headers: { ...headers, 'x-alicorn-org': 'org-acme' } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ tenantId: 'org-acme', actor: 'kc-sub-1', userId: null })
  })

  it('refuses an alias-only organisation claim rather than guessing the id', async () => {
    const app = keycloakApp()
    const res = await app.request('/v1/probe', {
      headers: {
        authorization: `Bearer ${await accessToken({ organization: ['acme'] })}`,
        'x-alicorn-org': 'org-acme'
      }
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'org_claim_unresolvable' })
  })

  it('refuses a token from another issuer', async () => {
    const token = await server.keycloak.sign(
      { sub: 'kc-sub-1', azp: CLIENT_ID, typ: 'Bearer', organization: { acme: { id: 'org-acme' } } },
      { issuer: 'http://someone-elses-keycloak.example/realms/alicorn' }
    )
    const res = await keycloakApp().request('/v1/probe', {
      headers: { authorization: `Bearer ${token}`, 'x-alicorn-org': 'org-acme' }
    })
    expect(res.status).toBe(401)
  })

  it('refuses to construct without a verifier in keycloak mode', () => {
    const config = loadLedgerApiConfig({
      ALICORN_DATABASE_URL: 'postgres://x',
      ALICORN_AUTH_MODE: 'keycloak',
      ALICORN_KEYCLOAK_ISSUER: server.issuer
    })
    expect(() => createLedgerApiApp({ config, pool: {} as never })).toThrow(/verifyAccessToken/)
  })
})
