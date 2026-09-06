import { Hono } from 'hono'
import type { ControlApiEnv } from './app-env.js'
import { requireTenant } from './require-tenant.js'
import { registerMembersRoutes } from './members-routes.js'
import { registerOrgPolicyRoutes } from './org-policy-routes.js'
import { registerRequiredChecksRoutes } from './required-checks-routes.js'

export type { ControlApiDeps } from './app-env.js'
import type { ControlApiDeps } from './app-env.js'

export function createControlApiApp(deps: ControlApiDeps): Hono<ControlApiEnv> {
  const app = new Hono<ControlApiEnv>()
  app.get('/healthz', (c) => c.json({ ok: true, service: 'control-api' }))
  app.use('/v1/*', requireTenant(deps))
  registerMembersRoutes(app, deps)
  registerOrgPolicyRoutes(app, deps)
  registerRequiredChecksRoutes(app, deps)
  return app
}
