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

// Run in keycloak mode with a stub verifier rather than local mode: local mode has one shared
// bearer and therefore no second principal, so `forbidden`, `cannot_remove_self` and
// `cannot_change_own_role` are unreachable there. The last test covers what local mode does say.

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_org_members_test'
const ISSUER = 'https://idp.test/realms/alicorn'
const ORG = 'org-acme'

describePostgres('alicorn organisation membership routes (postgres)', () => {
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>
  let ownerId: string
  let memberId: string

  // The bearer is the subject; the stub verifier turns it into claims proving membership of ORG.
  function headers(subject: string): Record<string, string> {
    return { authorization: `Bearer ${subject}`, 'x-alicorn-org': ORG, 'content-type': 'application/json' }
  }
  async function post(path: string, subject: string, body: unknown): Promise<Response> {
    return app.request(path, { method: 'POST', headers: headers(subject), body: JSON.stringify(body) })
  }
  async function roster(subject: string): Promise<Record<string, unknown>> {
    const res = await app.request('/v1/org/members', { headers: headers(subject) })
    expect(res.status).toBe(200)
    return (await res.json()) as Record<string, unknown>
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
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-org-test' })
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
      // The sign-in broker is not under test here, but keycloak mode refuses to construct without
      // it — these three exist only to satisfy that check.
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
      await client.query('DELETE FROM org_invites')
      await client.query('DELETE FROM org_roles')
      await client.query('DELETE FROM seats')
    })
    // First to sign in bootstraps as owner; everyone after is a member.
    ownerId = (await signIn('sub-owner', 'Owner@acme.test')).userId
    memberId = (await signIn('sub-member', 'member@acme.test')).userId
  })

  it('lists the organisation with the viewer s own role and a builder seat by default', async () => {
    expect(await roster('sub-owner')).toEqual({
      members: [
        { userId: memberId, email: 'member@acme.test', role: 'member', seat: 'builder' },
        { userId: ownerId, email: 'Owner@acme.test', role: 'owner', seat: 'builder' }
      ],
      pendingInvites: [],
      viewerRole: 'owner',
      canManageMembers: true
    })
    const asMember = await roster('sub-member')
    expect(asMember.viewerRole).toBe('member')
    expect(asMember.canManageMembers).toBe(false)
  })

  it('invites by email, lower-casing it, and refuses a second invite or an existing member', async () => {
    expect((await post('/v1/org/invites', 'sub-owner', { email: ' New@Acme.test ', role: 'admin' })).status).toBe(204)
    const listed = await roster('sub-owner')
    expect(listed.pendingInvites).toMatchObject([{ email: 'new@acme.test', role: 'admin', seat: 'builder' }])

    const again = await post('/v1/org/invites', 'sub-owner', { email: 'new@acme.test', role: 'member' })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'already_invited' })

    // Matched case-insensitively against the roster, or the owner could be invited into their own org.
    const existing = await post('/v1/org/invites', 'sub-owner', { email: 'owner@ACME.test', role: 'member' })
    expect(existing.status).toBe(409)
    expect(await existing.json()).toEqual({ error: 'already_member' })
  })

  it('turns an invite into the role and seat it named, at the invitee s first sign-in', async () => {
    expect(
      (await post('/v1/org/invites', 'sub-owner', { email: 'qa@acme.test', role: 'admin', seat: 'collaborator' }))
        .status
    ).toBe(204)
    const invited = await signIn('sub-qa', 'qa@acme.test')

    const listed = (await roster('sub-owner')) as { members: unknown[]; pendingInvites: unknown[] }
    expect(listed.pendingInvites).toEqual([])
    expect(listed.members).toContainEqual({
      userId: invited.userId,
      email: 'qa@acme.test',
      role: 'admin',
      seat: 'collaborator'
    })
  })

  it('revokes a pending invite, and answers not_found for one that was never sent', async () => {
    await post('/v1/org/invites', 'sub-owner', { email: 'gone@acme.test', role: 'member' })
    expect((await post('/v1/org/invites/revoke', 'sub-owner', { email: 'gone@acme.test' })).status).toBe(204)
    expect((await roster('sub-owner')).pendingInvites).toEqual([])

    const missing = await post('/v1/org/invites/revoke', 'sub-owner', { email: 'gone@acme.test' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'not_found' })
  })

  it('changes another member s role but never the caller s own', async () => {
    expect((await post('/v1/org/members/role', 'sub-owner', { userId: memberId, role: 'admin' })).status).toBe(204)
    const promoted = await roster('sub-member')
    expect(promoted.viewerRole).toBe('admin')

    const own = await post('/v1/org/members/role', 'sub-owner', { userId: ownerId, role: 'member' })
    expect(own.status).toBe(400)
    expect(await own.json()).toEqual({ error: 'cannot_change_own_role' })

    const unknown = await post('/v1/org/members/role', 'sub-owner', { userId: 'usr_nobody', role: 'admin' })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'not_found' })
  })

  it('removes a member with their seat, but never the caller themselves', async () => {
    const own = await post('/v1/org/members/remove', 'sub-owner', { userId: ownerId })
    expect(own.status).toBe(400)
    expect(await own.json()).toEqual({ error: 'cannot_remove_self' })

    expect((await post('/v1/org/members/remove', 'sub-owner', { userId: memberId })).status).toBe(204)
    expect((await roster('sub-owner')).members).toHaveLength(1)
    // The seat goes with the membership, or OP3 would still resolve connectors for an ex-member.
    const seats = await withTenant(pool, ORG, (client) =>
      client.query('SELECT user_id FROM seats WHERE user_id = $1', [memberId])
    )
    expect(seats.rowCount).toBe(0)

    const gone = await post('/v1/org/members/remove', 'sub-owner', { userId: memberId })
    expect(gone.status).toBe(404)
  })

  it('refuses every mutation from a plain member', async () => {
    for (const [path, body] of [
      ['/v1/org/invites', { email: 'x@acme.test', role: 'member' }],
      ['/v1/org/invites/revoke', { email: 'x@acme.test' }],
      ['/v1/org/members/role', { userId: ownerId, role: 'member' }],
      ['/v1/org/members/remove', { userId: ownerId }]
    ] as const) {
      const res = await post(path, 'sub-member', body)
      expect(res.status, path).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden' })
    }
  })

  it('rejects a malformed email and an unknown role', async () => {
    expect((await post('/v1/org/invites', 'sub-owner', { email: 'not-an-email', role: 'member' })).status).toBe(400)
    // Owner is held or bootstrapped, never mailed.
    expect((await post('/v1/org/invites', 'sub-owner', { email: 'x@acme.test', role: 'owner' })).status).toBe(400)
  })

  it('refuses an unauthenticated read', async () => {
    expect((await app.request('/v1/org/members')).status).toBe(401)
  })
})

// One organisation's membership is invisible to another even though both are in the same tables.
describePostgres('organisation membership is tenant-isolated', () => {
  const isolationSchema = 'control_org_members_rls_test'
  let pool: pg.Pool

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, isolationSchema)
    pool = await openControlPlanePool({
      databaseUrl: appUrl,
      schema: isolationSchema,
      applicationName: 'control-api-org-rls-test'
    })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
  })
  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, isolationSchema)
  })

  it('hides another organisation s invites and seats', async () => {
    await syncIdentity(pool, {
      idpIssuer: ISSUER,
      idpSubject: 'rls-sub',
      email: 'a@one.test',
      organizations: [{ orgId: 'org-one', name: 'one' }]
    })
    await withTenant(pool, 'org-one', (client) =>
      client.query(`INSERT INTO org_invites (tenant_id, email, role, invited_by) VALUES ($1,$2,$3,$4)`, [
        'org-one',
        'someone@one.test',
        'member',
        'usr_x'
      ])
    )
    const seen = await withTenant(pool, 'org-two', async (client) => ({
      invites: (await client.query('SELECT 1 FROM org_invites')).rowCount,
      roles: (await client.query('SELECT 1 FROM org_roles')).rowCount,
      seats: (await client.query('SELECT 1 FROM seats')).rowCount
    }))
    expect(seen).toEqual({ invites: 0, roles: 0, seats: 0 })

    // And a write into the wrong scope is refused by the policy rather than landing.
    await expect(
      withTenant(pool, 'org-two', (client) =>
        client.query(`INSERT INTO org_invites (tenant_id, email, role, invited_by) VALUES ($1,$2,$3,$4)`, [
          'org-one',
          'sneak@one.test',
          'member',
          'usr_x'
        ])
      )
    ).rejects.toThrow()
  })
})

// Tier 1 ships auth mode `local`: one constant tenant, one shared bearer, no sign-in. The
// organisation is still readable and invitable — which is what makes an invite useful before
// Keycloak, since the roster only fills in once people sign in.
describePostgres('the organisation in auth mode local', () => {
  const localSchema = 'control_org_members_local_test'
  let pool: pg.Pool
  let app: Hono<ControlApiEnv>
  const authHeaders = {
    authorization: 'Bearer local-dev-token-0123456789',
    'x-alicorn-actor': 'huy',
    'content-type': 'application/json'
  }

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, localSchema)
    pool = await openControlPlanePool({
      databaseUrl: appUrl,
      schema: localSchema,
      applicationName: 'control-api-org-local-test'
    })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
    app = createControlApiApp({
      config: loadControlApiConfig({
        ALICORN_DATABASE_URL: appUrl,
        ALICORN_LOCAL_API_TOKEN: 'local-dev-token-0123456789',
        ALICORN_TENANT_ID: 'local'
      }),
      pool
    })
  })
  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, localSchema)
  })

  it('answers an empty roster whose viewer is the owner, and records an invite', async () => {
    expect(await (await app.request('/v1/org/members', { headers: authHeaders })).json()).toEqual({
      members: [],
      pendingInvites: [],
      viewerRole: 'owner',
      canManageMembers: true
    })
    const invited = await app.request('/v1/org/invites', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email: 'first@acme.test', role: 'admin', seat: 'collaborator' })
    })
    expect(invited.status).toBe(204)
    const listed = (await (await app.request('/v1/org/members', { headers: authHeaders })).json()) as {
      pendingInvites: unknown[]
    }
    expect(listed.pendingInvites).toMatchObject([{ email: 'first@acme.test', role: 'admin', seat: 'collaborator' }])
  })
})
