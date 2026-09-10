import type { Hono } from 'hono'
import { ProjectInputSchema } from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject
} from './projects-repository.js'
import { readJsonBody } from './read-json-body.js'
import { isValidProjectId } from './project-id-param.js'

/** A duplicate name, key or a moved repo all surface as 409 rather than a 500 from the index. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export function registerProjectsRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  app.get('/v1/projects', async (c) => {
    const auth = c.get('auth')
    return c.json({ projects: await listProjects(deps.pool, auth.tenantId) })
  })

  app.post('/v1/projects', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = ProjectInputSchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    try {
      const project = await createProject(deps.pool, auth.tenantId, auth.actor, result.data)
      return c.json({ project }, 201)
    } catch (error) {
      if (isUniqueViolation(error)) return c.json({ error: 'project_exists' }, 409)
      throw error
    }
  })

  app.get('/v1/projects/:projectId', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) return c.json({ error: 'invalid_project_id' }, 400)
    const project = await getProject(deps.pool, auth.tenantId, projectId)
    if (!project) return c.json({ error: 'not_found' }, 404)
    return c.json({ project })
  })

  app.put('/v1/projects/:projectId', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) return c.json({ error: 'invalid_project_id' }, 400)
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = ProjectInputSchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    try {
      const project = await updateProject(deps.pool, auth.tenantId, projectId, result.data)
      if (!project) return c.json({ error: 'not_found' }, 404)
      return c.json({ project })
    } catch (error) {
      if (isUniqueViolation(error)) return c.json({ error: 'project_exists' }, 409)
      throw error
    }
  })

  // Deleting a project unbinds its repositories; it does not delete their configuration, which is
  // keyed by an opaque project id and stays exactly where it was.
  app.delete('/v1/projects/:projectId', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) return c.json({ error: 'invalid_project_id' }, 400)
    const deleted = await deleteProject(deps.pool, auth.tenantId, projectId)
    if (!deleted) return c.json({ error: 'not_found' }, 404)
    return c.body(null, 204)
  })
}
