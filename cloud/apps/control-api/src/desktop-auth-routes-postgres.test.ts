import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createKeycloakVerifiers,
  startTestKeycloakServer,
  type TestKeycloakServer
} from '@alicorn-cloud/control-plane-auth'
import {
  applySchema,
  createTestSchema,
  dropTestSchema,
  openControlPlanePool
} from '@alicorn-cloud/control-plane-postgres'
import type { Hono } from 'hono'
import type { ControlApiEnv } from './app-env.js'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import { lookupUserIdBySubject } from './identity-repository.js'
import { createPostgresDesktopIdentityStore } from './postgres-desktop-identity-store.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

// The other broker test runs the whole surface against the in-process double. This one runs the
// same routes against the store that actually ships, because the thing worth proving is that
// swapping the implementation changed no route behaviour — and that a /v1 request now carries the
// internal user id rather than the subject.

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_desktop_auth_test'
const CLIENT_ID = 'alicorn-desktop'
const NONCE = 'nonce-from-the-desktop'

describePostgres('desktop auth broker on the postgres identity store', () => {
  let pool: pg.Pool
  let server: TestKeycloakServer
  let app: Hono<ControlApiEnv>

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-broker-test' })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    server = await startTestKeycloakServer({ clientId: CLIENT_ID })
    const config = loadControlApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_AUTH_MODE: 'keycloak',
      ALICORN_KEYCLOAK_ISSUER: server.issuer,
      ALICORN_DESKTOP_CLIENT_ID: CLIENT_ID
    })
    if (config.auth.authMode !== 'keycloak') throw new Error('expected keycloak mode')
    const idpIssuer = config.auth.issuer
    app = createControlApiApp({
      config,
      pool,
      ...createKeycloakVerifiers(config.auth),
      tokenClient: { exchangeCode, refresh, logout: async () => {} },
      identityStore: createPostgresDesktopIdentityStore({ pool, idpIssuer }),
      lookupUserId: (idpSubject) => lookupUserIdBySubject(pool, idpSubject)
    })
    app.get('/v1/probe', (c) => c.json(c.get('auth')))
  })

  afterAll(async () => {
    await server.close()
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  // The token endpoint is driven directly rather than through the stub server's own exchange, so
  // each test can choose the subject and organisations the realm vouches for.
  let nextClaims: Record<string, unknown> = {}
  async function exchangeCode(): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; idToken?: string }> {
    return {
      accessToken: await server.keycloak.sign({ azp: CLIENT_ID, typ: 'Bearer', ...nextClaims }),
      idToken: await server.keycloak.sign(
        { azp: CLIENT_ID, typ: 'ID', nonce: NONCE, ...nextClaims },
        { audience: CLIENT_ID }
      ),
      refreshToken: 'refresh-token',
      expiresIn: 300
    }
  }
  const refresh = exchangeCode

  beforeEach(() => {
    nextClaims = { sub: 'kc-sub-1', email: 'dev@acme.test', organization: { acme: { id: 'org-acme' } } }
  })

  function session(body: Record<string, unknown> = {}) {
    return app.request('/v1/desktop/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'the-code',
        codeVerifier: 'the-verifier',
        nonce: NONCE,
        redirectUri: 'http://127.0.0.1:54321/auth/callback',
        state: 'the-state',
        localProfileId: 'local-profile-1',
        ...body
      })
    })
  }

  type Cloud = { userId: string; cloudProfileId: string; activeOrgId?: string }
  async function signIn(): Promise<Cloud> {
    const res = await session()
    expect(res.status).toBe(200)
    return ((await res.json()) as { cloud: Cloud }).cloud
  }

  it('links a session and keeps the ids stable across a second sign-in', async () => {
    const first = await signIn()
    expect(first.userId).toMatch(/^usr_/)
    expect(first.activeOrgId).toBe('org-acme')
    const second = await signIn()
    expect(second.userId).toBe(first.userId)
    expect(second.cloudProfileId).toBe(first.cloudProfileId)
  })

  it('puts the internal user id on a /v1 request — never the subject', async () => {
    const cloud = await signIn()
    const token = await server.keycloak.sign({
      sub: 'kc-sub-1',
      azp: CLIENT_ID,
      typ: 'Bearer',
      organization: { acme: { id: 'org-acme' } }
    })
    const res = await app.request('/v1/probe', {
      headers: { authorization: `Bearer ${token}`, 'x-alicorn-org': 'org-acme' }
    })
    expect(res.status).toBe(200)
    // `actor` is what every product row stamps into created_by, so this is the assertion the
    // ticket exists for: a subject must not be able to reach a product table.
    expect(await res.json()).toEqual({ tenantId: 'org-acme', actor: cloud.userId, userId: cloud.userId })
  })

  it('refuses a verified subject that never linked a session', async () => {
    const token = await server.keycloak.sign({
      sub: 'kc-sub-never-here',
      azp: CLIENT_ID,
      typ: 'Bearer',
      organization: { acme: { id: 'org-acme' } }
    })
    const res = await app.request('/v1/probe', {
      headers: { authorization: `Bearer ${token}`, 'x-alicorn-org': 'org-acme' }
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unknown_user' })
  })

  it('selects an organisation the token proves and refuses one it does not', async () => {
    nextClaims = {
      sub: 'kc-sub-2',
      email: 'two@acme.test',
      organization: { acme: { id: 'org-acme' }, globex: { id: 'org-globex' } }
    }
    await signIn()
    const token = await server.keycloak.sign({
      sub: 'kc-sub-2',
      azp: CLIENT_ID,
      typ: 'Bearer',
      organization: { acme: { id: 'org-acme' }, globex: { id: 'org-globex' } }
    })
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const ok = await app.request('/v1/desktop/auth/org', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orgId: 'org-globex' })
    })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { cloud: Cloud }).cloud.activeOrgId).toBe('org-globex')

    const denied = await app.request('/v1/desktop/auth/org', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orgId: 'org-nope' })
    })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 'not_a_member' })
  })
})
