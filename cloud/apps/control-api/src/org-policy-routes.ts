import type { Hono } from 'hono'
import { OrgPolicySchema } from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import { getOrgPolicy, putOrgPolicy } from './org-policy-repository.js'

export function registerOrgPolicyRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  app.get('/v1/policy/review-backend', async (c) => {
    const auth = c.get('auth')
    const policy = await getOrgPolicy(deps.pool, auth.tenantId)
    return c.json(policy)
  })

  app.put('/v1/policy/review-backend', async (c) => {
    const auth = c.get('auth')
    const result = OrgPolicySchema.safeParse(await c.req.json())
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    const policy = await putOrgPolicy(deps.pool, auth.tenantId, auth.actor, result.data)
    return c.json(policy)
  })
}
