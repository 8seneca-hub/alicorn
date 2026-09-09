import type pg from 'pg'
import { organizationsFromClaim, type KeycloakAccessClaims } from '@alicorn-cloud/control-plane-auth'
import {
  NotAMemberError,
  displayNameFromClaims,
  emailFromClaims,
  organizationsFromClaims,
  type DesktopIdentityRecord,
  type DesktopIdentityStore,
  type DesktopOrganization
} from './desktop-identity-store.js'
import { resolveTenantAliases, syncIdentity } from './identity-repository.js'

// The durable half of the seam I2 left: the same four methods, backed by `users`, `tenants`,
// `org_roles` and `cloud_profiles`, so an identity mapping outlives the process that made it.
// The claims→record rules are unchanged and still live in `desktop-identity-store.ts`; what
// changes is where the ids come from — Postgres mints `users.id` and `cloud_profiles.id`, and
// nothing is derived from the IdP subject.
export function createPostgresDesktopIdentityStore(input: {
  pool: pg.Pool
  // The realm that vouched for the subject. Part of the identity key, because two realms can
  // issue the same `sub` and they are not the same person.
  idpIssuer: string
}): DesktopIdentityStore {
  const { pool, idpIssuer } = input

  async function organizations(claims: KeycloakAccessClaims): Promise<DesktopOrganization[]> {
    const parsed = organizationsFromClaim(claims.organization)
    // An alias-only claim carries no id, so it is resolved against organisations a verified token
    // has already named. Unresolvable aliases are dropped, never guessed.
    const aliasIds = new Map(Object.entries(await resolveTenantAliases(pool, parsed.unresolvedAliases)))
    return organizationsFromClaims(claims, aliasIds)
  }

  async function record(
    claims: KeycloakAccessClaims,
    options: { localProfileId?: string; requestedOrgId?: string } = {}
  ): Promise<DesktopIdentityRecord> {
    const orgs = await organizations(claims)
    const synced = await syncIdentity(pool, {
      idpIssuer,
      idpSubject: claims.sub,
      email: emailFromClaims(claims),
      displayName: displayNameFromClaims(claims),
      localProfileId: options.localProfileId,
      organizations: orgs,
      requestedOrgId: options.requestedOrgId
    })
    // The role the membership row actually holds. Additive: the desktop's normalizer already
    // treats `role` as optional, so an older client that ignores it is unaffected.
    const withRoles = orgs.map((org) => ({ ...org, role: synced.rolesByOrgId[org.orgId] ?? org.role }))
    const active = withRoles.find((org) => org.orgId === synced.activeOrgId)
    return {
      userId: synced.userId,
      cloudProfileId: synced.cloudProfileId,
      email: emailFromClaims(claims),
      displayName: displayNameFromClaims(claims),
      activeOrgId: active?.orgId,
      activeOrgName: active?.name,
      organizations: withRoles
    }
  }

  return {
    linkSession: ({ claims, localProfileId }) => record(claims, { localProfileId }),
    resumeSession: ({ claims }) => record(claims),
    async selectOrganization({ claims, orgId }) {
      // Membership is decided by this token, not by what `org_roles` remembers — a stored row can
      // only ever be stale, and honouring one would let a revoked membership outlive its token.
      const orgs = await organizations(claims)
      if (!orgs.some((org) => org.orgId === orgId)) throw new NotAMemberError()
      return record(claims, { requestedOrgId: orgId })
    },
    resolveOrgAliases: (aliases) => resolveTenantAliases(pool, aliases)
  }
}
