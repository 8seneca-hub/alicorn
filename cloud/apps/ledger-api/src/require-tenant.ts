import { timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import type { AuthContext, LedgerApiEnv } from './app-env.js'

// Why: re-export for test and route type imports.
export type { AuthContext } from './app-env.js'

export function readBearer(value: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(value ?? '')
  return match?.[1] ?? null
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function requireTenant(deps: {
  config: { tenantId: string; localApiToken: string }
}): MiddlewareHandler<LedgerApiEnv> {
  return async (c, next) => {
    const bearer = readBearer(c.req.header('authorization'))
    if (!bearer || !tokenMatches(bearer, deps.config.localApiToken)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const org = c.req.header('x-alicorn-org')
    if (org !== undefined && org !== deps.config.tenantId) {
      return c.json({ error: 'not_a_member' }, 403)
    }
    c.set('auth', { tenantId: deps.config.tenantId, actor: c.req.header('x-alicorn-actor')?.slice(0, 120) ?? 'local' })
    await next()
  }
}
