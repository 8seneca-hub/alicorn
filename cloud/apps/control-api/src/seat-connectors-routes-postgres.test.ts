import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  applySchema,
  createTestSchema,
  dropTestSchema,
  openControlPlanePool,
  withTenant
} from '@alicorn-cloud/control-plane-postgres'
import type { Hono } from 'hono'
import type { KeycloakAccessClaims } from '@alicorn-cloud/control-plane-auth'
import type { ControlApiEnv } from './app-env.js'
import { createControlApiApp } from './app.js'
import { loadControlApiConfig } from './config.js'
import { lookupUserIdBySubject, syncIdentity } from './identity-repository.js'
import { createPostgresDesktopIdentityStore } from './postgres-desktop-identity-store.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

// Keycloak mode with a stub verifier, for the same reason the membership suite uses one: local
// mode has a single shared bearer and therefore no second principal, so neither `forbidden` nor
// "another seat's connectors" is reachable there. The last case covers what local mode answers.

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_seat_connectors_test'
const ISSUER = 'https://idp.test/realms/alicorn'
const ORG = 'org-acme'

const DRIVE = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-gdrive'], env: ['GDRIVE_TOKEN_PATH'] }
const SHAREPOINT = { command: 'npx', args: ['-y', 'mcp-sharepoint'], env: ['SHAREPOINT_SITE'] }

describePostgres('seat-scoped MCP connectors (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>
  let ownerId: string
  let collaboratorId: string

  function headers(subject: string): Record<string, string> {
    return { authorization: `Bearer ${subject}`, 'x-alicorn-org': ORG, 'content-type': 'application/json' }
  }
  async function get(path: string, subject: string): Promise<Response> {
    return app.request(path, { headers: headers(subject) })
  }
  async function put(path: string, subject: string, body: unknown): Promise<Response> {
    return app.request(path, { method: 'PUT', headers: headers(subject), body: JSON.stringify(body) })
  }
  async function del(path: string, subject: string): Promise<Response> {
    return app.request(path, { method: 'DELETE', headers: headers(subject) })
  }
  function signIn(subject: string, email: string): Promise<{ userId: string }> {
    return syncIdentity(pool, {
      idpIssuer: ISSUER,
      idpSubject: subject,
      email,
      organizations: [{ orgId: ORG, name: 'acme' }]
    })
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-seat-test' })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    const config = loadControlApiConfig({
      ALICORN_DATABASE_URL: appUrl,
      ALICORN_AUTH_MODE: 'keycloak',
      ALICORN_KEYCLOAK_ISSUER: ISSUER
    })
    app = createControlApiApp({
      config,
      pool,
      verifyAccessToken: async (token): Promise<KeycloakAccessClaims | null> =>
        token
          ? {
              sub: token,
              azp: 'alicorn-desktop',
              exp: Math.floor(Date.now() / 1000) + 300,
              organization: { acme: { id: ORG } }
            }
          : null,
      lookupUserId: (idpSubject) => lookupUserIdBySubject(pool, idpSubject),
      verifyIdToken: async () => null,
      tokenClient: {
        exchangeCode: () => Promise.reject(new Error('unused')),
        refresh: () => Promise.reject(new Error('unused')),
        logout: async () => {}
      },
      identityStore: createPostgresDesktopIdentityStore({ pool, idpIssuer: ISSUER })
    })
  })

  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  beforeEach(async () => {
    await withTenant(pool, ORG, async (client) => {
      await client.query('DELETE FROM seat_connectors')
      await client.query('DELETE FROM org_invites')
      await client.query('DELETE FROM org_roles')
      await client.query('DELETE FROM seats')
    })
    ownerId = (await signIn('sub-owner', 'owner@acme.test')).userId
    await app.request('/v1/org/invites', {
      method: 'POST',
      headers: headers('sub-owner'),
      body: JSON.stringify({ email: 'reviewer@acme.test', role: 'member', seat: 'collaborator' })
    })
    collaboratorId = (await signIn('sub-reviewer', 'reviewer@acme.test')).userId
  })

  it('an admin authors a connector on a seat and the seat holder reads it back as me', async () => {
    expect((await put(`/v1/org/seats/${collaboratorId}/connectors/gdrive`, 'sub-owner', { server: DRIVE }).then((r) => r.status))).toBe(204)

    const mine = await get('/v1/org/seats/me/connectors', 'sub-reviewer')
    expect(mine.status).toBe(200)
    expect(await mine.json()).toEqual({
      seat: 'collaborator',
      connectors: [{ userId: collaboratorId, kind: 'gdrive', server: DRIVE, updatedAt: expect.any(String) }]
    })
  })

  it('scopes to one seat: the builder in the same organisation sees none of the collaborator s', async () => {
    await put(`/v1/org/seats/${collaboratorId}/connectors/gdrive`, 'sub-owner', { server: DRIVE })
    await put(`/v1/org/seats/${ownerId}/connectors/sharepoint`, 'sub-owner', { server: SHAREPOINT })

    expect(await get('/v1/org/seats/me/connectors', 'sub-owner').then((r) => r.json())).toEqual({
      seat: 'builder',
      connectors: [{ userId: ownerId, kind: 'sharepoint', server: SHAREPOINT, updatedAt: expect.any(String) }]
    })
  })

  it('a member may read only its own seat, and may never author one', async () => {
    const other = await get(`/v1/org/seats/${ownerId}/connectors`, 'sub-reviewer')
    expect(other.status).toBe(403)
    expect(await other.json()).toEqual({ error: 'forbidden' })

    // The invariant: a member that authors its own connector authors its own execution surface.
    const own = await put('/v1/org/seats/me/connectors/gdrive', 'sub-reviewer', { server: DRIVE })
    expect(own.status).toBe(403)
    expect((await del('/v1/org/seats/me/connectors/gdrive', 'sub-reviewer')).status).toBe(403)
  })

  it('refuses env that is a value rather than a variable name, and an unknown connector kind', async () => {
    const secret = await put(`/v1/org/seats/${collaboratorId}/connectors/gdrive`, 'sub-owner', {
      server: { ...DRIVE, env: ['ya29.a0AfB_by-not-a-name'] }
    })
    expect(secret.status).toBe(400)
    expect((await secret.json() as { error: string }).error).toBe('invalid_body')

    const unknown = await put(`/v1/org/seats/${collaboratorId}/connectors/dropbox`, 'sub-owner', { server: DRIVE })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'unknown_connector_kind' })
  })

  it('fails closed when the seat is gone: no seat, no connector, and removal takes them with it', async () => {
    await put(`/v1/org/seats/${collaboratorId}/connectors/gdrive`, 'sub-owner', { server: DRIVE })
    expect(
      (
        await app.request('/v1/org/members/remove', {
          method: 'POST',
          headers: headers('sub-owner'),
          body: JSON.stringify({ userId: collaboratorId })
        })
      ).status
    ).toBe(204)

    const rows = await withTenant(pool, ORG, (client) =>
      client.query('SELECT 1 FROM seat_connectors WHERE user_id = $1', [collaboratorId])
    )
    expect(rows.rowCount).toBe(0)
    expect(await get(`/v1/org/seats/${collaboratorId}/connectors`, 'sub-owner').then((r) => r.json())).toEqual({
      seat: null,
      connectors: []
    })

    // A user who never had a seat cannot be given a connector — the seat is the gate.
    const noSeat = await put('/v1/org/seats/usr_nobody/connectors/gdrive', 'sub-owner', { server: DRIVE })
    expect(noSeat.status).toBe(404)
    expect(await noSeat.json()).toEqual({ error: 'no_seat' })
  })

  it('deletes one kind and leaves the other, answering not_found for one already gone', async () => {
    await put(`/v1/org/seats/${collaboratorId}/connectors/gdrive`, 'sub-owner', { server: DRIVE })
    await put(`/v1/org/seats/${collaboratorId}/connectors/sharepoint`, 'sub-owner', { server: SHAREPOINT })
    expect((await del(`/v1/org/seats/${collaboratorId}/connectors/gdrive`, 'sub-owner')).status).toBe(204)

    const left = (await get(`/v1/org/seats/${collaboratorId}/connectors`, 'sub-owner').then((r) => r.json())) as {
      connectors: { kind: string }[]
    }
    expect(left.connectors.map((connector) => connector.kind)).toEqual(['sharepoint'])
    expect((await del(`/v1/org/seats/${collaboratorId}/connectors/gdrive`, 'sub-owner')).status).toBe(404)
  })
})

// Local mode has no user to *be*, so `me` resolves to nobody. The narrow answer is the empty set:
// an unresolvable seat must never inherit the organisation's connectors.
describePostgres('seat-scoped MCP connectors in local mode (postgres)', () => {
  const localSchema = 'control_seat_connectors_local_test'
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, localSchema)
    pool = await openControlPlanePool({
      databaseUrl: appUrl,
      schema: localSchema,
      applicationName: 'control-api-seat-local-test'
    })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    app = createControlApiApp({
      config: loadControlApiConfig({
        ALICORN_DATABASE_URL: appUrl,
        ALICORN_AUTH_MODE: 'local',
        ALICORN_LOCAL_API_TOKEN: 'local-token-for-tests'
      }),
      pool
    })
  })

  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, localSchema)
  })

  it('answers me with no seat and no connectors', async () => {
    const res = await app.request('/v1/org/seats/me/connectors', {
      headers: { authorization: 'Bearer local-token-for-tests' }
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ seat: null, connectors: [] })
  })
})
