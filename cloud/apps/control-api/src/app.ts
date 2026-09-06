import { Hono } from 'hono'
import type pg from 'pg'
import type { ControlApiEnv } from './app-env.js'
import type { ControlApiConfig } from './config.js'
import { requireTenant } from './require-tenant.js'
import { registerMembersRoutes } from './members-routes.js'

export type ControlApiDeps = {
  config: ControlApiConfig
  pool: pg.Pool
  now?: () => number
}

export function createControlApiApp(deps: ControlApiDeps): Hono<ControlApiEnv> {
  const app = new Hono<ControlApiEnv>()
  app.get('/healthz', (c) => c.json({ ok: true, service: 'control-api' }))
  app.use('/v1/*', requireTenant(deps))
  registerMembersRoutes(app, deps)
  // Routes are registered by a later task: registerOrgPolicyRoutes / registerRequiredChecksRoutes (A6).
  return app
}
