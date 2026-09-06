import type { Hono } from 'hono'
import { z } from 'zod'
import { RequiredChecksSchema } from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import { getRequiredChecks, putRequiredChecks } from './required-checks-repository.js'
import { readJsonBody } from './read-json-body.js'

const PutRequiredChecksBodySchema = z.object({ checks: RequiredChecksSchema })

// Why: projectId is Orca's opaque project/repo id — accept any non-empty string within a sane bound.
function isValidProjectId(projectId: string): boolean {
  return projectId.length >= 1 && projectId.length <= 200
}

export function registerRequiredChecksRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  app.get('/v1/projects/:projectId/required-checks', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) {
      return c.json({ error: 'invalid_project_id' }, 400)
    }
    const checks = await getRequiredChecks(deps.pool, auth.tenantId, projectId)
    return c.json({ checks })
  })

  app.put('/v1/projects/:projectId/required-checks', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) {
      return c.json({ error: 'invalid_project_id' }, 400)
    }
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = PutRequiredChecksBodySchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    const checks = await putRequiredChecks(deps.pool, auth.tenantId, projectId, auth.actor, result.data.checks)
    return c.json({ checks })
  })
}
