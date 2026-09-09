import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applySchema,
  createTestSchema,
  dropTestSchema,
  openControlPlanePool,
  withTenant
} from '@alicorn-cloud/control-plane-postgres'
import type { KeycloakAccessClaims } from '@alicorn-cloud/control-plane-auth'
import { NotAMemberError, type DesktopIdentityStore } from './desktop-identity-store.js'
import { lookupUserIdBySubject } from './identity-repository.js'
import { createPostgresDesktopIdentityStore } from './postgres-desktop-identity-store.js'
import { CONTROL_SCHEMA_STATEMENTS } from './schema-sql.js'

const databaseUrl = process.env.ALICORN_TEST_POSTGRES_URL
const describePostgres = databaseUrl ? describe : describe.skip
const schema = 'control_identity_test'
const ISSUER = 'https://idp.test/realms/alicorn'

function claims(overrides: Partial<KeycloakAccessClaims> = {}): KeycloakAccessClaims {
  return {
    sub: 'kc-sub-1',
    azp: 'alicorn-desktop',
    exp: Math.floor(Date.now() / 1000) + 300,
    email: 'dev@acme.test',
    name: 'Dev User',
    preferred_username: 'dev',
    organization: { acme: { id: 'org-acme' } },
    ...overrides
  }
}

describePostgres('postgres desktop identity store', () => {
  let pool: pg.Pool
  // A fresh store per call, deliberately: it stands in for a restarted control API, and proves
  // the mapping lives in the tables rather than in the process.
  const store = (): DesktopIdentityStore => createPostgresDesktopIdentityStore({ pool, idpIssuer: ISSUER })

  beforeAll(async () => {
    const { appUrl } = await createTestSchema(databaseUrl!, schema)
    pool = await openControlPlanePool({ databaseUrl: appUrl, schema, applicationName: 'control-api-identity-test' })
    await applySchema(pool, CONTROL_SCHEMA_STATEMENTS)
  })
  afterAll(async () => {
    await pool.end()
    await dropTestSchema(databaseUrl!, schema)
  })

  describe('the internal user id', () => {
    it('is minted by the database, is not the subject, and is not derived from it', async () => {
      const record = await store().linkSession({ claims: claims({ sub: 'mint-1' }), localProfileId: 'lp-1' })
      expect(record.userId).toMatch(/^usr_[0-9a-f-]{36}$/)
      expect(record.cloudProfileId).toMatch(/^prf_[0-9a-f-]{36}$/)
      expect(record.userId).not.toContain('mint-1')
      // Two subjects that differ only in one character would collide under any derivation that
      // truncates a digest; under a minted id they cannot be compared at all.
      const other = await store().linkSession({ claims: claims({ sub: 'mint-2' }) })
      expect(other.userId).not.toBe(record.userId)
      expect(other.cloudProfileId).not.toBe(record.cloudProfileId)
    })

    it('survives the process that minted it', async () => {
      const first = await store().linkSession({ claims: claims({ sub: 'durable-1' }) })
      const second = await store().resumeSession({ claims: claims({ sub: 'durable-1' }) })
      // The desktop signs the user out if either id moves, so a control API restart must not
      // reassign them — which is exactly what the in-process store could not promise.
      expect(second.userId).toBe(first.userId)
      expect(second.cloudProfileId).toBe(first.cloudProfileId)
    })

    it('does not move when the realm s public URL does', async () => {
      const before = await store().linkSession({ claims: claims({ sub: 'moved-realm' }) })
      const after = await createPostgresDesktopIdentityStore({
        pool,
        idpIssuer: 'https://auth.example.com/realms/alicorn'
      }).resumeSession({ claims: claims({ sub: 'moved-realm' }) })
      // Renaming the issuer is an ordinary deployment change; keying identity on it would sign
      // everyone out and orphan every row they own. The issuer is recorded, not part of the key.
      expect(after.userId).toBe(before.userId)
      const { rows } = await pool.query(`SELECT idp_issuer FROM users WHERE id = $1`, [before.userId])
      expect(rows).toEqual([{ idp_issuer: 'https://auth.example.com/realms/alicorn' }])
    })

    it('is what every foreign key points at — no key anywhere references the IdP subject', async () => {
      const { rows } = await pool.query<{ table_name: string; column_name: string }>(
        `SELECT rel.relname AS table_name, att.attname AS column_name
           FROM pg_constraint con
           JOIN pg_class rel ON rel.oid = con.confrelid
           JOIN pg_namespace ns ON ns.oid = rel.relnamespace
           CROSS JOIN LATERAL unnest(con.confkey) AS k(attnum)
           JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum
          WHERE con.contype = 'f' AND ns.nspname = $1 AND rel.relname = 'users'`,
        [schema]
      )
      expect(rows.length).toBeGreaterThan(0)
      expect([...new Set(rows.map((r) => r.column_name))]).toEqual(['id'])
    })

    it('is what requireTenant will put on the request, and is null for an unknown subject', async () => {
      const record = await store().linkSession({ claims: claims({ sub: 'hot-path-1' }) })
      expect(await lookupUserIdBySubject(pool, 'hot-path-1')).toBe(record.userId)
      expect(await lookupUserIdBySubject(pool, 'never-signed-in')).toBeNull()
    })
  })

  describe('org sync from claims', () => {
    it('records the organisations the token proves, and the membership under each tenant', async () => {
      const record = await store().linkSession({
        claims: claims({ sub: 'sync-1', organization: { zulu: { id: 'org-z' }, acme: { id: 'org-a' } } })
      })
      expect(record.organizations.map((org) => org.name)).toEqual(['acme', 'zulu'])
      const tenants = await pool.query(`SELECT id, alias FROM tenants WHERE id IN ('org-a','org-z') ORDER BY id`)
      expect(tenants.rows).toEqual([
        { id: 'org-a', alias: 'acme' },
        { id: 'org-z', alias: 'zulu' }
      ])
      for (const orgId of ['org-a', 'org-z']) {
        const membership = await withTenant(pool, orgId, (c) =>
          c.query(`SELECT user_id, role FROM org_roles WHERE user_id = $1`, [record.userId])
        )
        expect(membership.rows).toEqual([{ user_id: record.userId, role: 'owner' }])
      }
      expect(record.organizations).toEqual([
        { orgId: 'org-a', name: 'acme', role: 'owner' },
        { orgId: 'org-z', name: 'zulu', role: 'owner' }
      ])
    })

    it('makes the first person to sign in the organisation s owner and everyone after a member', async () => {
      const org = { fresh: { id: 'org-fresh' } }
      const first = await store().linkSession({ claims: claims({ sub: 'owner-1', organization: org }) })
      const second = await store().linkSession({ claims: claims({ sub: 'owner-2', organization: org }) })
      expect(first.organizations[0]!.role).toBe('owner')
      expect(second.organizations[0]!.role).toBe('member')
      // A second sign-in must not demote the owner it already recorded.
      const again = await store().resumeSession({ claims: claims({ sub: 'owner-1', organization: org }) })
      expect(again.organizations[0]!.role).toBe('owner')
    })

    it('resolves an alias-only claim only once some token has proven what it maps to', async () => {
      expect(await store().resolveOrgAliases(['brand-new'])).toEqual({})
      await store().linkSession({ claims: claims({ sub: 'alias-1', organization: { 'brand-new': { id: 'org-bn' } } }) })
      expect(await store().resolveOrgAliases(['brand-new', 'nope'])).toEqual({ 'brand-new': 'org-bn' })
      // The array form of the claim carries no ids at all, so it is only usable once resolved.
      const record = await store().linkSession({ claims: claims({ sub: 'alias-2', organization: ['brand-new'] }) })
      expect(record.organizations).toEqual([{ orgId: 'org-bn', name: 'brand-new', role: 'member' }])
    })

    it('lets a realm move an alias to another organisation without breaking sign-in', async () => {
      await store().linkSession({ claims: claims({ sub: 'moved-1', organization: { moving: { id: 'org-old' } } }) })
      await store().linkSession({ claims: claims({ sub: 'moved-1', organization: { moving: { id: 'org-new' } } }) })
      expect(await store().resolveOrgAliases(['moving'])).toEqual({ moving: 'org-new' })
      const released = await pool.query(`SELECT alias FROM tenants WHERE id = 'org-old'`)
      expect(released.rows).toEqual([{ alias: null }])
    })
  })

  describe('profile and organisation selection', () => {
    const two = (sub: string): KeycloakAccessClaims =>
      claims({ sub, organization: { acme: { id: 'org-acme' }, globex: { id: 'org-globex' } } })

    it('remembers the selected organisation across a restart', async () => {
      await store().linkSession({ claims: two('select-1') })
      expect((await store().selectOrganization({ claims: two('select-1'), orgId: 'org-globex' })).activeOrgId).toBe(
        'org-globex'
      )
      const resumed = await store().resumeSession({ claims: two('select-1') })
      expect(resumed.activeOrgId).toBe('org-globex')
      expect(resumed.activeOrgName).toBe('globex')
      const stored = await pool.query(`SELECT active_tenant_id FROM cloud_profiles WHERE id = $1`, [
        resumed.cloudProfileId
      ])
      expect(stored.rows).toEqual([{ active_tenant_id: 'org-globex' }])
    })

    it('drops a remembered organisation the presented token no longer proves', async () => {
      await store().linkSession({ claims: two('select-2') })
      await store().selectOrganization({ claims: two('select-2'), orgId: 'org-globex' })
      const narrowed = await store().resumeSession({ claims: claims({ sub: 'select-2' }) })
      expect(narrowed.activeOrgId).toBe('org-acme')
    })

    it('refuses an organisation the token does not carry', async () => {
      await store().linkSession({ claims: claims({ sub: 'select-3' }) })
      await expect(
        store().selectOrganization({ claims: claims({ sub: 'select-3' }), orgId: 'org-globex' })
      ).rejects.toBeInstanceOf(NotAMemberError)
    })

    it('leaves the active organisation unset when the token carries none', async () => {
      const record = await store().linkSession({ claims: claims({ sub: 'select-4', organization: undefined }) })
      expect(record.organizations).toEqual([])
      expect(record.activeOrgId).toBeUndefined()
    })

    it('keeps one profile per user and remembers the local profile it was linked from', async () => {
      const first = await store().linkSession({ claims: claims({ sub: 'profile-1' }), localProfileId: 'lp-9' })
      const again = await store().resumeSession({ claims: claims({ sub: 'profile-1' }) })
      expect(again.cloudProfileId).toBe(first.cloudProfileId)
      const { rows } = await pool.query(`SELECT local_profile_id FROM cloud_profiles WHERE user_id = $1`, [
        first.userId
      ])
      // A resume carries no localProfileId; it must not erase the one the link recorded.
      expect(rows).toEqual([{ local_profile_id: 'lp-9' }])
    })
  })

  describe('row-level security on org_roles', () => {
    it('hides one tenant s membership from another, and from a query with no tenant at all', async () => {
      const a = await store().linkSession({
        claims: claims({ sub: 'rls-a', organization: { alpha: { id: 'org-alpha' } } })
      })
      const b = await store().linkSession({
        claims: claims({ sub: 'rls-b', organization: { beta: { id: 'org-beta' } } })
      })

      const fromAlpha = await withTenant(pool, 'org-alpha', (c) => c.query(`SELECT user_id FROM org_roles`))
      expect(fromAlpha.rows.map((r) => r.user_id)).toEqual([a.userId])
      const fromBeta = await withTenant(pool, 'org-beta', (c) => c.query(`SELECT user_id FROM org_roles`))
      expect(fromBeta.rows.map((r) => r.user_id)).toEqual([b.userId])

      // No tenant set → the policy is false → nothing is visible, even to the owning role.
      const unscoped = await pool.query(`SELECT user_id FROM org_roles`)
      expect(unscoped.rows).toEqual([])
    })

    it('refuses to write a membership into another tenant', async () => {
      const a = await store().linkSession({
        claims: claims({ sub: 'rls-write', organization: { alpha: { id: 'org-alpha' } } })
      })
      await expect(
        withTenant(pool, 'org-alpha', (c) =>
          c.query(`INSERT INTO org_roles (tenant_id, user_id) VALUES ('org-beta', $1)`, [a.userId])
        )
      ).rejects.toMatchObject({ code: '42501' })
    })

    it('cannot be widened by deleting through another tenant s scope', async () => {
      const victim = await store().linkSession({
        claims: claims({ sub: 'rls-delete', organization: { beta: { id: 'org-beta' } } })
      })
      const deleted = await withTenant(pool, 'org-alpha', (c) =>
        c.query(`DELETE FROM org_roles WHERE user_id = $1`, [victim.userId])
      )
      expect(deleted.rowCount).toBe(0)
      const stillThere = await withTenant(pool, 'org-beta', (c) =>
        c.query(`SELECT user_id FROM org_roles WHERE user_id = $1`, [victim.userId])
      )
      expect(stillThere.rows).toEqual([{ user_id: victim.userId }])
    })
  })
})
