import type { Hono } from 'hono'
import { WorkflowInputSchema, WorkflowUpdateSchema } from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  type WriteResult
} from './workflows-repository.js'

const UNIQUE_VIOLATION = '23505'

// Why: scope the 409 to the name index — a duplicate edge or stage key is a bad payload (400),
// not a name conflict. Same shape as members-routes' mapping.
function isDuplicateNameViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, constraint } = error as { code?: string; constraint?: string }
  return code === UNIQUE_VIOLATION && constraint === 'workflows_tenant_project_name'
}

type JsonResponder = { json: (body: unknown, status?: 200 | 201 | 400 | 404 | 409) => Response }

function respond(c: JsonResponder, result: WriteResult, okStatus: 200 | 201): Response {
  switch (result.kind) {
    case 'ok':
      return c.json({ workflow: result.workflow }, okStatus)
    case 'not_found':
      return c.json({ error: 'not_found' }, 404)
    case 'version_conflict':
      return c.json({ error: 'version_conflict', version: result.version }, 409)
    case 'unknown_member':
      return c.json({ error: 'unknown_member', memberIds: result.memberIds }, 400)
  }
}

export function registerWorkflowsRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  app.get('/v1/workflows', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.query('projectId')
    const workflows = await listWorkflows(deps.pool, auth.tenantId, projectId)
    return c.json({ workflows })
  })

  app.post('/v1/workflows', async (c) => {
    const auth = c.get('auth')
    const result = WorkflowInputSchema.safeParse(await c.req.json())
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    try {
      return respond(c, await createWorkflow(deps.pool, auth.tenantId, auth.actor, result.data), 201)
    } catch (error) {
      if (isDuplicateNameViolation(error)) return c.json({ error: 'duplicate_name' }, 409)
      throw error
    }
  })

  app.get('/v1/workflows/:id', async (c) => {
    const auth = c.get('auth')
    const workflow = await getWorkflow(deps.pool, auth.tenantId, c.req.param('id'))
    if (!workflow) return c.json({ error: 'not_found' }, 404)
    return c.json({ workflow })
  })

  app.put('/v1/workflows/:id', async (c) => {
    const auth = c.get('auth')
    const result = WorkflowUpdateSchema.safeParse(await c.req.json())
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    const { version, ...graph } = result.data
    try {
      return respond(c, await updateWorkflow(deps.pool, auth.tenantId, c.req.param('id'), version, graph), 200)
    } catch (error) {
      if (isDuplicateNameViolation(error)) return c.json({ error: 'duplicate_name' }, 409)
      throw error
    }
  })

  app.delete('/v1/workflows/:id', async (c) => {
    const auth = c.get('auth')
    const deleted = await deleteWorkflow(deps.pool, auth.tenantId, c.req.param('id'))
    if (!deleted) return c.json({ error: 'not_found' }, 404)
    return c.body(null, 204)
  })
}
