import { Hono } from 'hono'
import type { LedgerApiEnv } from './app-env.js'

export type { LedgerApiDeps } from './app-env.js'
import type { LedgerApiDeps } from './app-env.js'
import { requireTenant } from '@alicorn-cloud/control-plane-auth'
import { registerLedgerRoutes } from './ledger-routes.js'
import { registerProvenanceExportRoutes, registerProvenanceJwksRoute } from './provenance-export-routes.js'
import { requestLog } from './request-log.js'
import { refreshAmendedWithinWindow, LedgerMetrics } from './ledger-metrics.js'

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
    // Why: the gauge needs a single tenant to scope; only local mode has one statically.
    if (deps.config.auth.authMode === 'local') {
      await refreshAmendedWithinWindow(metrics, deps.pool, deps.config.auth.tenantId)
    }
    return c.text(metrics.renderPrometheus(), 200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
  })
  registerProvenanceJwksRoute(app, deps)
  // No lookupUserId / resolveOrgAliases here: the ledger API has no identity tables, so a token
  // carrying only organisation aliases is refused rather than guessed at (org_claim_unresolvable).
  app.use('/v1/*', requireTenant({ config: deps.config.auth, verifyAccessToken: deps.verifyAccessToken }))
  registerLedgerRoutes(app, { ...deps, metrics })
  registerProvenanceExportRoutes(app, { ...deps, metrics })
  return app
}
