import type { Hono } from 'hono'
import {
  AutonomyPolicyInputSchema,
  StageConfigSchema,
  StageKeySchema
} from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import {
  getAutonomyPolicy,
  listAutonomyPolicies,
  putAutonomyPolicy
} from './autonomy-policy-repository.js'
import { getStageConfig, putStageConfig } from './project-stage-config-repository.js'
import { readJsonBody } from './read-json-body.js'
import { isValidProjectId } from './project-id-param.js'

const DEFAULT_STAGE_KEY = 'build'

export function registerAutonomyPolicyRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  // The policy that applies right now to one (project, stage, member). `policy: null` means the
  // project authored none — the caller applies the contract default, and knows it did.
  app.get('/v1/projects/:projectId/autonomy-policy', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) return c.json({ error: 'invalid_project_id' }, 400)
    const stageKey = StageKeySchema.safeParse(c.req.query('stageKey') ?? DEFAULT_STAGE_KEY)
    if (!stageKey.success) return c.json({ error: 'invalid_stage_key' }, 400)
    const policy = await getAutonomyPolicy(deps.pool, auth.tenantId, {
      projectId,
      stageKey: stageKey.data,
      memberId: c.req.query('memberId') ?? null
    })
    return c.json({ policy })
  })

  // §9's audit view: every authored policy for the project, including never_gate exceptions that
  // have not yet lapsed. Expiry is not filtered here — a lapsed exception is exactly what an
  // auditor wants to see.
  app.get('/v1/projects/:projectId/autonomy-policies', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) return c.json({ error: 'invalid_project_id' }, 400)
    const policies = await listAutonomyPolicies(deps.pool, auth.tenantId, projectId)
    return c.json({ policies })
  })

  app.put('/v1/projects/:projectId/autonomy-policy', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) return c.json({ error: 'invalid_project_id' }, 400)
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = AutonomyPolicyInputSchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    // A member cannot loosen its own criteria: the author is the authenticated actor, never a
    // field the request body gets to choose.
    const policy = await putAutonomyPolicy(
      deps.pool,
      auth.tenantId,
      projectId,
      auth.actor,
      result.data
    )
    return c.json({ policy })
  })

  app.get('/v1/projects/:projectId/stage-config/:stageKey', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) return c.json({ error: 'invalid_project_id' }, 400)
    const stageKey = StageKeySchema.safeParse(c.req.param('stageKey'))
    if (!stageKey.success) return c.json({ error: 'invalid_stage_key' }, 400)
    const config = await getStageConfig(deps.pool, auth.tenantId, projectId, stageKey.data)
    return c.json({ stageKey: stageKey.data, config })
  })

  app.put('/v1/projects/:projectId/stage-config/:stageKey', async (c) => {
    const auth = c.get('auth')
    const projectId = c.req.param('projectId')
    if (!isValidProjectId(projectId)) return c.json({ error: 'invalid_project_id' }, 400)
    const stageKey = StageKeySchema.safeParse(c.req.param('stageKey'))
    if (!stageKey.success) return c.json({ error: 'invalid_stage_key' }, 400)
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = StageConfigSchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    const config = await putStageConfig(
      deps.pool,
      auth.tenantId,
      projectId,
      stageKey.data,
      auth.actor,
      result.data
    )
    return c.json({ stageKey: stageKey.data, config })
  })
}
