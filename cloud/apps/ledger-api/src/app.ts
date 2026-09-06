import { Hono } from 'hono'
import type { LedgerApiEnv } from './app-env.js'

export type { LedgerApiDeps } from './app-env.js'
import type { LedgerApiDeps } from './app-env.js'
import { requireTenant } from './require-tenant.js'
import { registerLedgerRoutes } from './ledger-routes.js'

export function createLedgerApiApp(deps: LedgerApiDeps): Hono<LedgerApiEnv> {
  const app = new Hono<LedgerApiEnv>()
  app.get('/healthz', (c) => c.json({ ok: true, service: 'ledger-api' }))
  app.use('/v1/*', requireTenant(deps))
  registerLedgerRoutes(app, deps)
  return app
}
