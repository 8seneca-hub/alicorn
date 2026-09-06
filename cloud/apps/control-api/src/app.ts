import { Hono } from 'hono'
import type pg from 'pg'
import type { ControlApiEnv } from './app-env.js'
import type { ControlApiConfig } from './config.js'

export type ControlApiDeps = {
  config: ControlApiConfig
  pool: pg.Pool
  now?: () => number
}

export function createControlApiApp(deps: ControlApiDeps): Hono<ControlApiEnv> {
  const app = new Hono<ControlApiEnv>()
  app.get('/healthz', (c) => c.json({ ok: true, service: 'control-api' }))
  // Routes are registered by later tasks: registerMembersRoutes(app, deps) (A5),
  // registerOrgPolicyRoutes / registerRequiredChecksRoutes (A6).
  return app
}
