import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createKeycloakVerifiers,
  startTestKeycloakServer,
  type TestKeycloakServer
} from '@alicorn-cloud/control-plane-auth'
import { z } from 'zod'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import { createInProcessDesktopIdentityStore } from './desktop-identity-store.js'
import { createKeycloakTokenClient } from './keycloak-token-client.js'

const CLIENT_ID = 'alicorn-desktop'
const NONCE = 'nonce-from-the-desktop'
const REDIRECT_URI = 'http://127.0.0.1:54321/auth/callback'

// A mirror of what src/main/orca-profiles/profile-cloud-client.ts insists on: `assertString`
// rejects a missing or blank string and `assertNumber` a missing number, so any of these being
// absent makes the desktop throw invalid_orca_cloud_* instead of signing in.
const CloudSummarySchema = z.object({
  cloudProfileId: z.string().min(1),
  userId: z.string().min(1),
  email: z.string().min(1),
  displayName: z.string().min(1).optional(),
  activeOrgId: z.string().min(1).optional(),
  activeOrgName: z.string().min(1).optional(),
  linkedAt: z.number()
})
const CapabilitiesSchema = z.object({ flags: z.record(z.boolean()), refreshedAt: z.number() })
const OrganizationsSchema = z.array(z.object({ orgId: z.string().min(1), name: z.string().min(1), role: z.string().optional() }))
const SessionResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  cloud: CloudSummarySchema,
  organizations: OrganizationsSchema,
  capabilities: CapabilitiesSchema
})
const ContextResponseSchema = z.object({
  cloud: CloudSummarySchema,
  organizations: OrganizationsSchema,
  capabilities: CapabilitiesSchema
})

const BROKER_PATHS = [
  '/v1/desktop/auth/session',
  '/v1/desktop/auth/refresh',
  '/v1/desktop/auth/capabilities',
  '/v1/desktop/auth/org',
  '/v1/desktop/auth/profile',
  '/v1/desktop/auth/logout'
]

let server: TestKeycloakServer

function keycloakApp(): ReturnType<typeof createControlApiApp> {
  const config = loadControlApiConfig({
    ALICORN_DATABASE_URL: 'postgres://x',
    ALICORN_AUTH_MODE: 'keycloak',
    ALICORN_KEYCLOAK_ISSUER: server.issuer,
    ALICORN_DESKTOP_CLIENT_ID: CLIENT_ID
  })
  if (config.auth.authMode !== 'keycloak') throw new Error('expected keycloak mode')
  const app = createControlApiApp({
    config,
    pool: {} as never,
    ...createKeycloakVerifiers(config.auth),
    tokenClient: createKeycloakTokenClient({ issuer: server.issuer, clientId: CLIENT_ID }),
    identityStore: createInProcessDesktopIdentityStore()
  })
  // A stand-in for any real /v1 route, to prove what requireTenant puts on the context.
  app.get('/v1/probe', (c) => c.json(c.get('auth')))
  return app
}

function localApp(): ReturnType<typeof createControlApiApp> {
  return createControlApiApp({
    config: loadControlApiConfig({
      ALICORN_DATABASE_URL: 'postgres://x',
      ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789'
    }),
    pool: {} as never
  })
}

function post(app: ReturnType<typeof createControlApiApp>, path: string, body: unknown, accessToken?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  })
}

function sessionBody(overrides: Record<string, unknown> = {}) {
  return {
    code: 'the-code',
    codeVerifier: 'the-verifier',
    nonce: NONCE,
    redirectUri: REDIRECT_URI,
    state: 'the-state',
    localProfileId: 'local-profile-1',
    ...overrides
  }
}

function mintsToken(organization: Record<string, { id: string }>, nonce = NONCE): void {
  server.setTokenResponse({
    accessTokenClaims: { organization },
    idTokenClaims: { nonce },
    expiresIn: 300
  })
}

beforeAll(async () => {
  server = await startTestKeycloakServer({ clientId: CLIENT_ID })
})
afterAll(async () => {
  await server.close()
})
beforeEach(() => {
  mintsToken({ acme: { id: 'org-acme' } })
})

describe('desktop auth broker — mode local is untouched', () => {
  it('answers 404 not_available_in_local_mode on every broker path', async () => {
    const app = localApp()
    for (const path of BROKER_PATHS) {
      const res = await post(app, path, {})
      expect([path, res.status]).toEqual([path, 404])
      expect(await res.json()).toEqual({ error: 'not_available_in_local_mode' })
    }
  })

  it('still guards other /v1 routes with the shared token', async () => {
    const app = localApp()
    app.get('/v1/probe', (c) => c.json(c.get('auth')))
    expect((await app.request('/v1/probe')).status).toBe(401)
    const ok = await app.request('/v1/probe', {
      headers: { authorization: 'Bearer local-dev-token-0123456789' }
    })
    expect(await ok.json()).toEqual({ tenantId: 'local', actor: 'local', userId: null })
  })
})

describe('POST /v1/desktop/auth/session', () => {
  it('exchanges the code and answers in the shape the desktop parses', async () => {
    const res = await post(keycloakApp(), '/v1/desktop/auth/session', sessionBody())
    expect(res.status).toBe(200)
    const parsed = SessionResponseSchema.safeParse(await res.json())
    expect(parsed.error?.issues ?? []).toEqual([])
    const value = parsed.data!
    expect(value.expiresAt).toBeGreaterThan(Date.now())
    expect(value.cloud.activeOrgId).toBe('org-acme')
    expect(value.cloud.activeOrgName).toBe('acme')
    expect(value.cloud.email).toBe('dev@acme.test')
    expect(value.organizations).toEqual([{ orgId: 'org-acme', name: 'acme' }])
    expect(value.capabilities.flags).toEqual({ alicorn: true, 'relay.use': true })
  })

  it('refuses an id token whose nonce is not the one the desktop started with', async () => {
    mintsToken({ acme: { id: 'org-acme' } }, 'someone-elses-nonce')
    const res = await post(keycloakApp(), '/v1/desktop/auth/session', sessionBody())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'nonce_mismatch' })
  })

  it('refuses an exchange with no id token rather than skipping the nonce check', async () => {
    const app = createBrokerAppWithTokens({
      accessToken: await signAccessToken({ organization: { acme: { id: 'org-acme' } } }),
      refreshToken: 'r',
      expiresIn: 300
    })
    const res = await post(app, '/v1/desktop/auth/session', sessionBody())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'id_token_missing' })
  })

  it('passes Keycloak s rejection through as 401 with its OAuth code', async () => {
    server.setTokenResponse({ error: { status: 400, code: 'invalid_grant' } })
    const res = await post(keycloakApp(), '/v1/desktop/auth/session', sessionBody())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'exchange_rejected', code: 'invalid_grant' })
  })

  it('rejects a malformed body before touching the IdP', async () => {
    const before = server.requests.length
    const res = await post(keycloakApp(), '/v1/desktop/auth/session', sessionBody({ code: '' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
    expect(server.requests.length).toBe(before)
  })
})

describe('POST /v1/desktop/auth/refresh', () => {
  it('keeps userId, cloudProfileId and activeOrgId stable — the desktop treats a change as a hijack', async () => {
    const app = keycloakApp()
    const first = SessionResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/session', sessionBody())).json()
    )
    const res = await post(app, '/v1/desktop/auth/refresh', { refreshToken: first.refreshToken })
    expect(res.status).toBe(200)
    const again = SessionResponseSchema.parse(await res.json())
    expect(again.cloud.userId).toBe(first.cloud.userId)
    expect(again.cloud.cloudProfileId).toBe(first.cloud.cloudProfileId)
    expect(again.cloud.activeOrgId).toBe(first.cloud.activeOrgId)
    expect(server.requests.at(-1)?.body.grant_type).toBe('refresh_token')
  })

  it('cannot launder a session into an organisation the new token does not prove', async () => {
    const app = keycloakApp()
    mintsToken({ acme: { id: 'org-acme' }, globex: { id: 'org-globex' } })
    const first = SessionResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/session', sessionBody())).json()
    )
    const switched = ContextResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/org', { orgId: 'org-globex' }, first.accessToken)).json()
    )
    expect(switched.cloud.activeOrgId).toBe('org-globex')

    // The next token drops globex; the remembered choice must not survive it.
    mintsToken({ acme: { id: 'org-acme' } })
    const refreshed = SessionResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/refresh', { refreshToken: first.refreshToken })).json()
    )
    expect(refreshed.organizations).toEqual([{ orgId: 'org-acme', name: 'acme' }])
    expect(refreshed.cloud.activeOrgId).toBe('org-acme')
  })

  it('remembers a switched organisation across a refresh that still proves it', async () => {
    const app = keycloakApp()
    mintsToken({ acme: { id: 'org-acme' }, globex: { id: 'org-globex' } })
    const first = SessionResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/session', sessionBody())).json()
    )
    await post(app, '/v1/desktop/auth/org', { orgId: 'org-globex' }, first.accessToken)
    const refreshed = SessionResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/refresh', { refreshToken: first.refreshToken })).json()
    )
    expect(refreshed.cloud.activeOrgId).toBe('org-globex')
  })

  it('answers 401 refresh_rejected when the IdP refuses the refresh token', async () => {
    server.setTokenResponse({ error: { status: 400, code: 'invalid_grant' } })
    const res = await post(keycloakApp(), '/v1/desktop/auth/refresh', { refreshToken: 'stale' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'refresh_rejected', code: 'invalid_grant' })
  })
})

describe('bearer broker routes', () => {
  it('answers 401 without a bearer', async () => {
    const app = keycloakApp()
    for (const path of ['/v1/desktop/auth/capabilities', '/v1/desktop/auth/org', '/v1/desktop/auth/logout']) {
      const res = await post(app, path, {})
      expect([path, res.status]).toEqual([path, 401])
    }
  })

  it('returns the current context on capabilities', async () => {
    const app = keycloakApp()
    const first = SessionResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/session', sessionBody())).json()
    )
    const res = await post(app, '/v1/desktop/auth/capabilities', {}, first.accessToken)
    expect(res.status).toBe(200)
    const value = ContextResponseSchema.parse(await res.json())
    expect(value.cloud.userId).toBe(first.cloud.userId)
    expect(value.capabilities.flags['relay.use']).toBe(true)
  })

  it('refuses an organisation the token does not carry', async () => {
    const app = keycloakApp()
    const first = SessionResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/session', sessionBody())).json()
    )
    const res = await post(app, '/v1/desktop/auth/org', { orgId: 'org-zzz' }, first.accessToken)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not_a_member' })
  })

  it('answers 501 on profile — multi-profile is not built', async () => {
    const res = await post(keycloakApp(), '/v1/desktop/auth/profile', { orgId: 'org-acme', name: 'x' })
    expect(res.status).toBe(501)
    expect(await res.json()).toEqual({ error: 'not_implemented' })
  })

  it('revokes at the IdP and answers a body the desktop can parse', async () => {
    const app = keycloakApp()
    const first = SessionResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/session', sessionBody())).json()
    )
    const res = await post(app, '/v1/desktop/auth/logout', { refreshToken: first.refreshToken }, first.accessToken)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(server.requests.at(-1)?.path).toContain('/protocol/openid-connect/logout')
  })
})

describe('what the broker refuses', () => {
  it('rejects a correctly signed token from another issuer', async () => {
    const token = await server.keycloak.sign(
      { sub: 'kc-sub-1', azp: CLIENT_ID, typ: 'Bearer', organization: { acme: { id: 'org-acme' } } },
      { issuer: 'http://someone-elses-keycloak.example/realms/alicorn' }
    )
    const res = await post(keycloakApp(), '/v1/desktop/auth/capabilities', {}, token)
    expect(res.status).toBe(401)
  })

  it('rejects a token issued to another client', async () => {
    const token = await signAccessToken({ azp: 'some-other-client' })
    const res = await post(keycloakApp(), '/v1/desktop/auth/capabilities', {}, token)
    expect(res.status).toBe(401)
  })

  it('rejects an expired token', async () => {
    const token = await server.keycloak.sign(
      { sub: 'kc-sub-1', azp: CLIENT_ID, typ: 'Bearer', organization: { acme: { id: 'org-acme' } } },
      { expiresIn: '-1s' }
    )
    const res = await post(keycloakApp(), '/v1/desktop/auth/capabilities', {}, token)
    expect(res.status).toBe(401)
  })

  it('rejects an id token presented as a bearer', async () => {
    const token = await server.keycloak.sign(
      { sub: 'kc-sub-1', azp: CLIENT_ID, typ: 'ID' },
      { audience: CLIENT_ID }
    )
    const res = await post(keycloakApp(), '/v1/desktop/auth/capabilities', {}, token)
    expect(res.status).toBe(401)
  })
})

describe('the tenant a broker-issued token then reaches /v1 with', () => {
  it('is the organisation the token proves, selected by x-alicorn-org', async () => {
    const app = keycloakApp()
    const first = SessionResponseSchema.parse(
      await (await post(app, '/v1/desktop/auth/session', sessionBody())).json()
    )
    const headers = { authorization: `Bearer ${first.accessToken}` }

    const missing = await app.request('/v1/probe', { headers })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'org_header_required' })

    const unproven = await app.request('/v1/probe', { headers: { ...headers, 'x-alicorn-org': 'org-zzz' } })
    expect(unproven.status).toBe(403)
    expect(await unproven.json()).toEqual({ error: 'not_a_member' })

    const ok = await app.request('/v1/probe', { headers: { ...headers, 'x-alicorn-org': 'org-acme' } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ tenantId: 'org-acme', actor: 'kc-sub-1', userId: null })
  })
})

async function signAccessToken(claims: Record<string, unknown> = {}): Promise<string> {
  return server.keycloak.sign({
    sub: 'kc-sub-1',
    azp: CLIENT_ID,
    typ: 'Bearer',
    email: 'dev@acme.test',
    ...claims
  })
}

// A broker whose token endpoint answers exactly the tokens given — used to cover a response
// the realm should never send but the broker must not trust anyway.
function createBrokerAppWithTokens(tokens: {
  accessToken: string
  refreshToken: string
  expiresIn: number
}): ReturnType<typeof createControlApiApp> {
  const config = loadControlApiConfig({
    ALICORN_DATABASE_URL: 'postgres://x',
    ALICORN_AUTH_MODE: 'keycloak',
    ALICORN_KEYCLOAK_ISSUER: server.issuer,
    ALICORN_DESKTOP_CLIENT_ID: CLIENT_ID
  })
  if (config.auth.authMode !== 'keycloak') throw new Error('expected keycloak mode')
  return createControlApiApp({
    config,
    pool: {} as never,
    ...createKeycloakVerifiers(config.auth),
    tokenClient: {
      exchangeCode: async () => tokens,
      refresh: async () => tokens,
      logout: async () => undefined
    },
    identityStore: createInProcessDesktopIdentityStore()
  })
}
