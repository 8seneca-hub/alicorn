import { Hono } from 'hono'
import type { ControlApiEnv } from './app-env.js'
import { requireTenant } from '@alicorn-cloud/control-plane-auth'
import { registerMembersRoutes } from './members-routes.js'
import { registerOrgPolicyRoutes } from './org-policy-routes.js'
import { registerRequiredChecksRoutes } from './required-checks-routes.js'
import { registerRuleProposalsRoutes } from './rule-proposals-routes.js'
import { registerWorkflowsRoutes } from './workflows-routes.js'
import { requestLog } from './request-log.js'
import { ControlMetrics } from './control-metrics.js'

export type { ControlApiDeps } from './app-env.js'
import type { ControlApiDeps } from './app-env.js'

export function createControlApiApp(deps: ControlApiDeps): Hono<ControlApiEnv> {
  const app = new Hono<ControlApiEnv>()
  const metrics = deps.metrics ?? new ControlMetrics()
  app.onError((error, c) => {
    console.error('[alicorn-control-api] unhandled', error)
    return c.json({ error: 'internal' }, 500)
  })
  app.use('*', requestLog<ControlApiEnv>('control-api'))
  app.use('*', async (c, next) => {
    await next()
    metrics.incHttpRequest(c.req.method, c.res.status)
  })
  app.get('/healthz', (c) => c.json({ ok: true, service: 'control-api' }))
  // Why (LC-R4): unauthenticated like /healthz — same port, no second listener; loopback/network-policy covers reachability.
  app.get('/metrics', (c) => c.text(metrics.renderPrometheus(), 200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }))
  app.use('/v1/*', requireTenant({ config: deps.config.auth }))
  registerMembersRoutes(app, deps)
  registerOrgPolicyRoutes(app, deps)
  registerRequiredChecksRoutes(app, deps)
  registerRuleProposalsRoutes(app, deps)
  registerWorkflowsRoutes(app, deps)
  return app
}
