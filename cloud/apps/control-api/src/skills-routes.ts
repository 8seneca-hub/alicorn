import type { Hono } from 'hono'
import {
  SkillInputSchema,
  SkillLatestInputSchema,
  SkillVersionInputSchema
} from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import { viewerRoleOf } from './org-members-repository.js'
import {
  createSkill,
  getSkill,
  listSkills,
  publishSkillVersion,
  setLatestVersion
} from './skills-repository.js'
import { parseJsonBody } from './read-json-body.js'

// The org skill catalog (OP2a). Writes are admin-only — a member's skill list is additive to the
// catalog, never a mutation of it, and a stage check that names a catalog skill would mean
// nothing if the member being judged could republish what it points at. Reads are open to the
// organisation: resolution has to see the catalog to merge it with project and pinned skills.

export function registerSkillsRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  async function forbidden(tenantId: string, userId: string | null): Promise<boolean> {
    return (await viewerRoleOf(deps.pool, tenantId, userId)) === 'member'
  }

  app.get('/v1/skills', async (c) => {
    const auth = c.get('auth')
    const scope = c.req.query('scope')
    if (scope !== undefined && scope !== 'org' && scope !== 'project') {
      return c.json({ error: 'invalid_scope' }, 400)
    }
    const skills = await listSkills(deps.pool, auth.tenantId, { scope, projectId: c.req.query('projectId') })
    return c.json({ skills })
  })

  app.post('/v1/skills', async (c) => {
    const auth = c.get('auth')
    if (await forbidden(auth.tenantId, auth.userId)) return c.json({ error: 'forbidden' }, 403)
    const body = await parseJsonBody(c, SkillInputSchema)
    if (!body.ok) return body.response
    try {
      return c.json({ skill: await createSkill(deps.pool, auth.tenantId, auth.actor, body.data) }, 201)
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return c.json({ error: 'duplicate_name' }, 409)
      throw error
    }
  })

  app.get('/v1/skills/:id', async (c) => {
    const auth = c.get('auth')
    const found = await getSkill(deps.pool, auth.tenantId, c.req.param('id'))
    if (!found) return c.json({ error: 'not_found' }, 404)
    return c.json(found)
  })

  app.post('/v1/skills/:id/versions', async (c) => {
    const auth = c.get('auth')
    if (await forbidden(auth.tenantId, auth.userId)) return c.json({ error: 'forbidden' }, 403)
    const body = await parseJsonBody(c, SkillVersionInputSchema)
    if (!body.ok) return body.response
    const version = await publishSkillVersion(deps.pool, auth.tenantId, c.req.param('id'), body.data)
    if (!version) return c.json({ error: 'not_found' }, 404)
    return c.json({ version })
  })

  app.put('/v1/skills/:id/latest', async (c) => {
    const auth = c.get('auth')
    if (await forbidden(auth.tenantId, auth.userId)) return c.json({ error: 'forbidden' }, 403)
    const body = await parseJsonBody(c, SkillLatestInputSchema)
    if (!body.ok) return body.response
    const result = await setLatestVersion(deps.pool, auth.tenantId, c.req.param('id'), body.data.versionId)
    if (result.outcome === 'not_found') return c.json({ error: 'not_found' }, 404)
    if (result.outcome === 'unknown_version') return c.json({ error: 'unknown_version' }, 400)
    return c.json({ skill: result.skill })
  })
}
