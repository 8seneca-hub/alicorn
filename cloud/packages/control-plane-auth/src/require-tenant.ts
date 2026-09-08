import { timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import type { ControlPlaneAuthEnv } from './auth-context.js'
import type { AuthConfig } from './auth-env-schema.js'
import { organizationsFromClaim, type KeycloakAccessClaims } from './keycloak-claims.js'
import { readBearer } from './read-bearer.js'

export type { KeycloakAccessClaims } from './keycloak-claims.js'

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type RequireTenantDeps = {
  config: AuthConfig
  verifyAccessToken?: (token: string) => Promise<KeycloakAccessClaims | null>
  lookupUserId?: (idpSubject: string) => Promise<string | null>
  resolveOrgAliases?: (aliases: string[]) => Promise<Record<string, string>>
}

export function requireTenant(deps: RequireTenantDeps): MiddlewareHandler<ControlPlaneAuthEnv> {
  if (deps.config.authMode === 'keycloak') return keycloakTenant(deps)
  const config = deps.config
  return async (c, next) => {
    const bearer = readBearer(c.req.header('authorization'))
    if (!bearer || !tokenMatches(bearer, config.localApiToken)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const org = c.req.header('x-alicorn-org')
    if (org !== undefined && org !== config.tenantId) {
      return c.json({ error: 'not_a_member' }, 403)
    }
    c.set('auth', {
      tenantId: config.tenantId,
      actor: c.req.header('x-alicorn-actor')?.slice(0, 120) ?? 'local',
      userId: null
    })
    await next()
  }
}

function keycloakTenant(deps: RequireTenantDeps): MiddlewareHandler<ControlPlaneAuthEnv> {
  const verifyAccessToken = deps.verifyAccessToken
  // Why: without a verifier this middleware would have nothing to check; fail at construction
  // rather than at the first request, where it would look like a token problem.
  if (!verifyAccessToken) throw new Error('verifyAccessToken required in keycloak mode')
  const { lookupUserId, resolveOrgAliases } = deps

  return async (c, next) => {
    const bearer = readBearer(c.req.header('authorization'))
    if (!bearer) return c.json({ error: 'unauthorized' }, 401)
    const claims = await verifyAccessToken(bearer)
    if (!claims) return c.json({ error: 'unauthorized' }, 401)

    // Why: the tenant is never taken from the header alone — the header only selects which of
    // the token's proven organisations to act as, so an unproven id can never become tenant_id.
    const requestedOrg = c.req.header('x-alicorn-org')
    if (!requestedOrg) return c.json({ error: 'org_header_required' }, 400)

    const orgs = organizationsFromClaim(claims.organization)
    let member = orgs.resolved.some((org) => org.id === requestedOrg)
    if (!member && orgs.unresolvedAliases.length > 0) {
      if (!resolveOrgAliases) return c.json({ error: 'org_claim_unresolvable' }, 403)
      const byAlias = await resolveOrgAliases(orgs.unresolvedAliases)
      member = orgs.unresolvedAliases.some((alias) => byAlias[alias] === requestedOrg)
    }
    if (!member) return c.json({ error: 'not_a_member' }, 403)

    let userId: string | null = null
    if (lookupUserId) {
      userId = await lookupUserId(claims.sub)
      // Why: a verified subject that never went through /session has no internal user row, and
      // every product row keys off users.id — fail closed rather than inventing one here.
      if (!userId) return c.json({ error: 'unknown_user' }, 401)
    }

    c.set('auth', { tenantId: requestedOrg, actor: userId ?? claims.sub, userId })
    await next()
  }
}
