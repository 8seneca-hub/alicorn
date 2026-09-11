import type { Hono } from 'hono'
import { TaskInputSchema, TaskPatchSchema } from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import { createTask, deleteTask, getTask, listTasks, updateTask } from './tasks-repository.js'
import { readJsonBody } from './read-json-body.js'
import { isValidProjectId } from './project-id-param.js'
import { resolveProjectId } from './projects-repository.js'

/** Two creates that read the same MAX(number); the loser retries rather than seeing a 500. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export function registerTasksRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  // Project-scoped, and resolved the same way every other project route is: the id may name a
  // project or a repository bound to one, so a caller that only knows a repo still reads a board.
  app.get('/v1/projects/:projectId/tasks', async (c) => {
    const auth = c.get('auth')
    const param = c.req.param('projectId')
    if (!isValidProjectId(param)) return c.json({ error: 'invalid_project_id' }, 400)
    const projectId = await resolveProjectId(deps.pool, auth.tenantId, param)
    return c.json({ tasks: await listTasks(deps.pool, auth.tenantId, projectId) })
  })

  app.post('/v1/tasks', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = TaskInputSchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    const projectId = await resolveProjectId(deps.pool, auth.tenantId, result.data.projectId)
    try {
      const task = await createTask(deps.pool, auth.tenantId, auth.actor, {
        ...result.data,
        projectId
      })
      if (!task) return c.json({ error: 'project_not_found' }, 404)
      return c.json({ task }, 201)
    } catch (error) {
      if (isUniqueViolation(error)) return c.json({ error: 'task_number_taken' }, 409)
      throw error
    }
  })

  app.get('/v1/tasks/:taskId', async (c) => {
    const auth = c.get('auth')
    const task = await getTask(deps.pool, auth.tenantId, c.req.param('taskId'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    return c.json({ task })
  })

  app.patch('/v1/tasks/:taskId', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = TaskPatchSchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    const task = await updateTask(deps.pool, auth.tenantId, c.req.param('taskId'), result.data)
    if (!task) return c.json({ error: 'not_found' }, 404)
    return c.json({ task })
  })

  app.delete('/v1/tasks/:taskId', async (c) => {
    const auth = c.get('auth')
    const deleted = await deleteTask(deps.pool, auth.tenantId, c.req.param('taskId'))
    if (!deleted) return c.json({ error: 'not_found' }, 404)
    return c.body(null, 204)
  })
}
