import { timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import type { ControlPlaneAuthEnv } from './auth-context.js'
import type { AuthConfig } from './auth-env-schema.js'
import { readBearer } from './read-bearer.js'

// Why: placeholder until Task 4's keycloak-claims.ts defines the real schema.
export type KeycloakAccessClaims = { sub: string }

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
  // Why: keycloak wiring lands in Task 4; fail fast rather than silently accepting requests.
  if (deps.config.authMode === 'keycloak') throw new Error('keycloak mode not implemented')
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
