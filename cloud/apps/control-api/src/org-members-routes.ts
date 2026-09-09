import type { Context, Hono } from 'hono'
import type { z } from 'zod'
import {
  OrgInviteInputSchema,
  OrgInviteRevokeInputSchema,
  OrgMemberRemoveInputSchema,
  OrgMemberRoleInputSchema,
  type OrgRole
} from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import {
  changeMemberRole,
  createInvite,
  readRoster,
  readViewerRole,
  removeMember,
  revokeInvite,
  toResponse
} from './org-members-repository.js'
import { readJsonBody } from './read-json-body.js'

// The Alicorn organisation (OP1), never Orca's relay-backed account org — see CLAUDE.md. The
// paths and error codes are the ones `profile-cloud-org-members-client.ts` already speaks
// (plan Decision 4), so the desktop's roster rendering and error mapping carry over unchanged.
//
// **Keycloak organisation sync — creating the KC organisation member and sending the invite mail —
// lands with the identity plan (I5).** Here an invite is a row; `syncIdentity` consumes it at the
// invitee's first sign-in, which is the only place a membership is ever created.

// Why local mode is `owner`: it has one constant tenant and one shared bearer, so there is no
// second principal to be less privileged than. A real role appears the moment a token carries a
// subject that maps to an internal user id.
async function viewerRoleOf(deps: ControlApiDeps, tenantId: string, userId: string | null): Promise<OrgRole> {
  if (!userId) return 'owner'
  // Fail closed: a verified member with no membership row administers nothing.
  return (await readViewerRole(deps.pool, tenantId, userId)) ?? 'member'
}

async function parsed<T extends z.ZodTypeAny>(
  c: Context<ControlApiEnv>,
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  const body = await readJsonBody(c)
  if (!body.ok) return { ok: false, response: c.json({ error: 'invalid_body', issues: [] }, 400) }
  const result = schema.safeParse(body.value)
  if (!result.success) {
    return { ok: false, response: c.json({ error: 'invalid_body', issues: result.error.issues }, 400) }
  }
  return { ok: true, data: result.data }
}

export function registerOrgMembersRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  app.get('/v1/org/members', async (c) => {
    const auth = c.get('auth')
    const [roster, viewerRole] = await Promise.all([
      readRoster(deps.pool, auth.tenantId),
      viewerRoleOf(deps, auth.tenantId, auth.userId)
    ])
    return c.json(toResponse(roster, viewerRole))
  })

  app.post('/v1/org/invites', async (c) => {
    const auth = c.get('auth')
    if ((await viewerRoleOf(deps, auth.tenantId, auth.userId)) === 'member') {
      return c.json({ error: 'forbidden' }, 403)
    }
    const body = await parsed(c, OrgInviteInputSchema)
    if (!body.ok) return body.response
    const outcome = await createInvite(deps.pool, auth.tenantId, auth.actor, body.data)
    if (outcome !== 'invited') return c.json({ error: outcome }, 409)
    return c.body(null, 204)
  })

  app.post('/v1/org/invites/revoke', async (c) => {
    const auth = c.get('auth')
    if ((await viewerRoleOf(deps, auth.tenantId, auth.userId)) === 'member') {
      return c.json({ error: 'forbidden' }, 403)
    }
    const body = await parsed(c, OrgInviteRevokeInputSchema)
    if (!body.ok) return body.response
    if (!(await revokeInvite(deps.pool, auth.tenantId, body.data.email))) {
      return c.json({ error: 'not_found' }, 404)
    }
    return c.body(null, 204)
  })

  app.post('/v1/org/members/role', async (c) => {
    const auth = c.get('auth')
    if ((await viewerRoleOf(deps, auth.tenantId, auth.userId)) === 'member') {
      return c.json({ error: 'forbidden' }, 403)
    }
    const body = await parsed(c, OrgMemberRoleInputSchema)
    if (!body.ok) return body.response
    // Why 400 and not 403: it is the request that is wrong, not the caller — an admin who could
    // demote themselves could lock the organisation out one click at a time.
    if (body.data.userId === auth.userId) return c.json({ error: 'cannot_change_own_role' }, 400)
    if (!(await changeMemberRole(deps.pool, auth.tenantId, body.data.userId, body.data.role))) {
      return c.json({ error: 'not_found' }, 404)
    }
    return c.body(null, 204)
  })

  app.post('/v1/org/members/remove', async (c) => {
    const auth = c.get('auth')
    if ((await viewerRoleOf(deps, auth.tenantId, auth.userId)) === 'member') {
      return c.json({ error: 'forbidden' }, 403)
    }
    const body = await parsed(c, OrgMemberRemoveInputSchema)
    if (!body.ok) return body.response
    if (body.data.userId === auth.userId) return c.json({ error: 'cannot_remove_self' }, 400)
    if (!(await removeMember(deps.pool, auth.tenantId, body.data.userId))) {
      return c.json({ error: 'not_found' }, 404)
    }
    return c.body(null, 204)
  })
}
