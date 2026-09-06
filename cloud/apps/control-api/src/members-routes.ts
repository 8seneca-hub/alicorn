import type { Hono } from 'hono'
import { MemberInputSchema } from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import { createMember, deleteMember, getMember, listMembers, updateMember } from './members-repository.js'
import { readJsonBody } from './read-json-body.js'

// Why: 23505 also fires for a duplicate skill in the payload (member_skills PK) —
// scope the mapping to the members_tenant_name index so only a real name conflict becomes 409 (R3).
const UNIQUE_VIOLATION = '23505'

function isDuplicateNameViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, constraint } = error as { code?: string; constraint?: string }
  return code === UNIQUE_VIOLATION && constraint === 'members_tenant_name'
}

export function registerMembersRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  app.get('/v1/members', async (c) => {
    const auth = c.get('auth')
    const members = await listMembers(deps.pool, auth.tenantId)
    return c.json({ members })
  })

  app.post('/v1/members', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = MemberInputSchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    try {
      const member = await createMember(deps.pool, auth.tenantId, auth.actor, result.data)
      return c.json({ member }, 201)
    } catch (error) {
      if (isDuplicateNameViolation(error)) return c.json({ error: 'duplicate_name' }, 409)
      throw error
    }
  })

  app.get('/v1/members/:id', async (c) => {
    const auth = c.get('auth')
    const member = await getMember(deps.pool, auth.tenantId, c.req.param('id'))
    if (!member) return c.json({ error: 'not_found' }, 404)
    return c.json({ member })
  })

  app.put('/v1/members/:id', async (c) => {
    const auth = c.get('auth')
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const result = MemberInputSchema.safeParse(body.value)
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
    try {
      const member = await updateMember(deps.pool, auth.tenantId, c.req.param('id'), result.data)
      if (!member) return c.json({ error: 'not_found' }, 404)
      return c.json({ member })
    } catch (error) {
      if (isDuplicateNameViolation(error)) return c.json({ error: 'duplicate_name' }, 409)
      throw error
    }
  })

  app.delete('/v1/members/:id', async (c) => {
    const auth = c.get('auth')
    const deleted = await deleteMember(deps.pool, auth.tenantId, c.req.param('id'))
    if (!deleted) return c.json({ error: 'not_found' }, 404)
    return c.body(null, 204)
  })
}
