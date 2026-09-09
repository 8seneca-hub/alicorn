import type pg from 'pg'
import { inTransaction, setTenantScope } from '@alicorn-cloud/control-plane-postgres'
import type { DesktopOrganization } from './desktop-identity-store.js'

// The identity mapping. Everything internal keys off `users.id`; the IdP subject reaches this
// file as a lookup argument and leaves it as nothing at all.

export type IdentitySyncInput = {
  idpIssuer: string
  idpSubject: string
  email: string
  displayName?: string
  localProfileId?: string
  // Already re-proven against the presented token by the caller — this repository never widens it.
  organizations: DesktopOrganization[]
  requestedOrgId?: string
}

export type IdentitySyncResult = {
  userId: string
  cloudProfileId: string
  activeOrgId?: string
  // orgId → the role the membership row holds, so the desktop sees the real role rather than a
  // decorative one. Populated from the same upsert that writes it, inside that tenant's scope.
  rolesByOrgId: Record<string, string>
}

// Why one transaction across four tables: a half-synced identity is a user with no profile, and
// the desktop reads a missing cloudProfileId as a hijacked session rather than as a retry.
export function syncIdentity(pool: pg.Pool, input: IdentitySyncInput): Promise<IdentitySyncResult> {
  return inTransaction(pool, async (client) => {
    const userId = await upsertUser(client, input)
    await upsertTenants(client, input.organizations)
    const profile = await upsertCloudProfile(client, userId, input)
    const rolesByOrgId = await syncMemberships(client, userId, input.organizations)
    return { userId, cloudProfileId: profile.cloudProfileId, activeOrgId: profile.activeOrgId, rolesByOrgId }
  })
}

async function upsertUser(client: pg.PoolClient, input: IdentitySyncInput): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (idp_subject, idp_issuer, email, display_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (idp_subject) DO UPDATE
       SET idp_issuer = EXCLUDED.idp_issuer,
           email = EXCLUDED.email,
           -- A realm that stops granting the profile scope should not blank a name we already have.
           display_name = COALESCE(EXCLUDED.display_name, users.display_name),
           last_seen_at = now(),
           updated_at = now()
     RETURNING id`,
    [input.idpSubject, input.idpIssuer, input.email, input.displayName ?? null]
  )
  return rows[0]!.id
}

async function upsertTenants(client: pg.PoolClient, organizations: DesktopOrganization[]): Promise<void> {
  for (const org of organizations) {
    // Why release first: the alias index is unique, so a realm that moves an alias to a new
    // organisation would otherwise fail every sign-in for everyone in the old one.
    await client.query(`UPDATE tenants SET alias = NULL, updated_at = now() WHERE alias = $1 AND id <> $2`, [
      org.name,
      org.orgId
    ])
    await client.query(
      `INSERT INTO tenants (id, alias, name) VALUES ($1, $2, $2)
       ON CONFLICT (id) DO UPDATE SET alias = EXCLUDED.alias, name = EXCLUDED.name, updated_at = now()`,
      [org.orgId, org.name]
    )
  }
}

async function upsertCloudProfile(
  client: pg.PoolClient,
  userId: string,
  input: IdentitySyncInput
): Promise<{ cloudProfileId: string; activeOrgId?: string }> {
  const existing = await client.query<{ id: string; active_tenant_id: string | null }>(
    `SELECT id, active_tenant_id FROM cloud_profiles WHERE user_id = $1`,
    [userId]
  )
  const remembered = input.requestedOrgId ?? existing.rows[0]?.active_tenant_id ?? undefined
  // A remembered choice survives only while this token still proves the membership; otherwise the
  // first proven organisation wins, so a refresh can never carry an organisation the token dropped.
  const active =
    input.organizations.find((org) => org.orgId === remembered) ?? input.organizations[0] ?? undefined

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO cloud_profiles (user_id, local_profile_id, active_tenant_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET local_profile_id = COALESCE(EXCLUDED.local_profile_id, cloud_profiles.local_profile_id),
           active_tenant_id = EXCLUDED.active_tenant_id,
           updated_at = now()
     RETURNING id`,
    [userId, input.localProfileId ?? null, active?.orgId ?? null]
  )
  return { cloudProfileId: rows[0]!.id, activeOrgId: active?.orgId }
}

// Why a scope change per organisation instead of one bulk insert: `org_roles` has RLS forced, so
// each row is only writable while `app.tenant_id` is that row's tenant. That is the point — a bug
// that tried to write a membership into the wrong organisation raises 42501 instead of landing.
// It also makes the owner rule below read exactly one organisation's membership and no other's.
async function syncMemberships(
  client: pg.PoolClient,
  userId: string,
  organizations: DesktopOrganization[]
): Promise<Record<string, string>> {
  const roles: Record<string, string> = {}
  for (const org of organizations) {
    await setTenantScope(client, org.orgId)
    const { rows } = await client.query<{ role: string }>(
      // DO UPDATE rather than DO NOTHING only so the row is returned either way — the role itself
      // is never rewritten here, or a second sign-in would demote the organisation's owner.
      `INSERT INTO org_roles (tenant_id, user_id, role)
       SELECT $1, $2, CASE WHEN EXISTS (SELECT 1 FROM org_roles WHERE tenant_id = $1) THEN 'member' ELSE 'owner' END
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET last_seen_at = now()
       RETURNING role`,
      [org.orgId, userId]
    )
    roles[org.orgId] = rows[0]!.role
  }
  return roles
}

export async function resolveTenantAliases(pool: pg.Pool, aliases: string[]): Promise<Record<string, string>> {
  if (aliases.length === 0) return {}
  const { rows } = await pool.query<{ id: string; alias: string }>(
    `SELECT id, alias FROM tenants WHERE alias = ANY($1::text[])`,
    [aliases]
  )
  return Object.fromEntries(rows.map((row) => [row.alias, row.id]))
}

// The hot-path half of the ticket: `requireTenant` puts this id on the request, so `created_by`
// and every other actor column holds a `users.id` and never a subject. One indexed lookup in this
// service's own pool — deliberately not a call to another service.
export async function lookupUserIdBySubject(pool: pg.Pool, idpSubject: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE idp_subject = $1`, [idpSubject])
  return rows[0]?.id ?? null
}
