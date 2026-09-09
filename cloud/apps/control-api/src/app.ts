import { Hono } from 'hono'
import type { ControlApiEnv } from './app-env.js'
import { requireTenant } from '@alicorn-cloud/control-plane-auth'
import { registerDesktopAuthRoutes } from './desktop-auth-routes.js'
import { registerMembersRoutes } from './members-routes.js'
import { registerOrgPolicyRoutes } from './org-policy-routes.js'
import { registerAutonomyPolicyRoutes } from './autonomy-policy-routes.js'
import { registerRequiredChecksRoutes } from './required-checks-routes.js'
import { registerProtectedPathsRoutes } from './protected-paths-routes.js'
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
  // Registered before the /v1/* guard so it is exempt from it: hono runs matched handlers in
  // registration order, and the desktop has no organisation to send until this exchange runs.
  registerDesktopAuthRoutes(app, deps)
  app.use(
    '/v1/*',
    requireTenant({
      config: deps.config.auth,
      verifyAccessToken: deps.verifyAccessToken,
      // I3: with the identity tables in place `auth.userId` is the internal `users.id`, and
      // `actor` follows it — a subject never reaches a product row. Absent (tests, and mode
      // `local`, which has no subject to map) it stays null, exactly as before.
      lookupUserId: deps.lookupUserId,
      resolveOrgAliases: deps.identityStore
        ? (aliases) => deps.identityStore!.resolveOrgAliases(aliases)
        : undefined
    })
  )
  registerMembersRoutes(app, deps)
  registerOrgPolicyRoutes(app, deps)
  registerAutonomyPolicyRoutes(app, deps)
  registerRequiredChecksRoutes(app, deps)
  registerProtectedPathsRoutes(app, deps)
  registerRuleProposalsRoutes(app, deps)
  registerWorkflowsRoutes(app, deps)
  return app
}
