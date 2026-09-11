import type { Hono } from 'hono'
import { z } from 'zod'
import { ProtectedPathsSchema } from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import { getProtectedPaths, putProtectedPaths } from './protected-paths-repository.js'
import { readJsonBody } from './read-json-body.js'
import { isValidProjectId } from './project-id-param.js'
import { resolveProjectId } from './projects-repository.js'

const PutProtectedPathsBodySchema = z.object({ paths: ProtectedPathsSchema })

/** Admin-authored reach surface (BR1). Same shape as required checks, and for the same reason. */
export function registerProtectedPathsRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  app.get('/v1/projects/:projectId/protected-paths', async (c) => {
    const auth = c.get('auth')
    const rawProjectId = c.req.param('projectId')
    if (!isValidProjectId(rawProjectId)) {
      return c.json({ error: 'invalid_project_id' }, 400)
    }
    const projectId = await resolveProjectId(deps.pool, auth.tenantId, rawProjectId)
    const paths = await getProtectedPaths(deps.pool, auth.tenantId, projectId)
    return c.json({ paths })
  })

  app.put('/v1/projects/:projectId/protected-paths', async (c) => {
    const auth = c.get('auth')
    const rawProjectId = c.req.param('projectId')
    if (!isValidProjectId(rawProjectId)) {
      return c.json({ error: 'invalid_project_id' }, 400)
    }
    const projectId = await resolveProjectId(deps.pool, auth.tenantId, rawProjectId)
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = PutProtectedPathsBodySchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    const paths = await putProtectedPaths(
      deps.pool,
      auth.tenantId,
      projectId,
      auth.actor,
      result.data.paths
    )
    return c.json({ paths })
  })
}
