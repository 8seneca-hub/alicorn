import { Hono } from 'hono'
import type { LedgerApiEnv } from './app-env.js'

export type { LedgerApiDeps } from './app-env.js'
import type { LedgerApiDeps } from './app-env.js'
import { requireTenant } from './require-tenant.js'
import { registerLedgerRoutes } from './ledger-routes.js'
import { requestLog } from './request-log.js'
import { countAmendedWithinWindow, LedgerMetrics } from './ledger-metrics.js'

export function createLedgerApiApp(deps: LedgerApiDeps): Hono<LedgerApiEnv> {
  const app = new Hono<LedgerApiEnv>()
  const metrics = deps.metrics ?? new LedgerMetrics()
  app.onError((error, c) => {
    console.error('[alicorn-ledger-api] unhandled', error)
    return c.json({ error: 'internal' }, 500)
  })
  app.use('*', requestLog<LedgerApiEnv>('ledger-api'))
  app.get('/healthz', (c) => c.json({ ok: true, service: 'ledger-api' }))
  // Why (LC-R4): unauthenticated like /healthz — same port, no second listener; loopback/network-policy covers reachability.
  app.get('/metrics', async (c) => {
    metrics.setAmendedWithinWindow(await countAmendedWithinWindow(deps.pool, deps.config.tenantId))
    return c.text(metrics.renderPrometheus(), 200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
  })
  app.use('/v1/*', requireTenant(deps))
  registerLedgerRoutes(app, { ...deps, metrics })
  return app
}
