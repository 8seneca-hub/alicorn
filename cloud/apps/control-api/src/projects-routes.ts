import type { Hono } from 'hono'
import {
  FEATURE_DELIVERY_TEMPLATE,
  ProjectInputSchema
} from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject
} from './projects-repository.js'
import { createWorkflowFromTemplate } from './workflows-repository.js'
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
    // A project with no repository has nowhere for its work to happen, and the repositories screen
    // cannot add one yet. Enforced on create only: a repo moving to another project legitimately
    // empties the one it left, and refusing *that* would block a move the model allows.
    if (result.data.repoIds.length === 0) {
      return c.json({ error: 'project_requires_repo' }, 400)
    }
    try {
      const project = await createProject(deps.pool, auth.tenantId, auth.actor, result.data)
      // Every project starts with the shipped pipeline rather than an empty canvas: a task with no
      // stage has nowhere to be in a workflow, and the board's columns already name these stages.
      // Best-effort on purpose — a project that exists without its workflow is recoverable (author
      // one), while refusing the whole create because the template failed is not.
      try {
        await createWorkflowFromTemplate(
          deps.pool,
          auth.tenantId,
          auth.actor,
          FEATURE_DELIVERY_TEMPLATE,
          project.id
        )
      } catch (workflowError) {
        console.warn('[projects] default workflow was not created', workflowError)
      }
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
