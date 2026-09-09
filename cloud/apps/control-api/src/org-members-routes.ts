import type { Hono } from 'hono'
import {
  OrgInviteInputSchema,
  OrgInviteRevokeInputSchema,
  OrgMemberRemoveInputSchema,
  OrgMemberRoleInputSchema
} from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import {
  changeMemberRole,
  createInvite,
  readRoster,
  removeMember,
  revokeInvite,
  toResponse,
  viewerRoleOf
} from './org-members-repository.js'
import { parseJsonBody as parsed } from './read-json-body.js'

// The Alicorn organisation (OP1), never Orca's relay-backed account org — see CLAUDE.md. The
// paths and error codes are the ones `profile-cloud-org-members-client.ts` already speaks
// (plan Decision 4), so the desktop's roster rendering and error mapping carry over unchanged.
//
// **Keycloak organisation sync — creating the KC organisation member and sending the invite mail —
// lands with the identity plan (I5).** Here an invite is a row; `syncIdentity` consumes it at the
// invitee's first sign-in, which is the only place a membership is ever created.
//
// **ALC-111 widens Decision 4's six codes by one: `409 last_owner`.** `forbidden` was the
// additive-free alternative and was rejected — it says the caller lacks permission, which is
// false here and unactionable (signing in as the owner does not help), so it buys a smaller wire
// at the cost of a support ticket. 409 rather than 400 because, unlike `cannot_change_own_role`,
// the identical request succeeds once a second owner exists: that is a state conflict, not a
// malformed request. Nothing consumes these routes yet — the desktop's roster still talks to the
// relay's `/v1/desktop/orgs/...` — so nothing on the desktop was changed. When something does bind
// here, `src/shared/orca-profiles.ts` needs a 409 reason that is not invite-shaped: today its
// mapper folds every unrecognised 409 into `already_invited`, which is worse than no code at all.
//
// **Still open: an admin may demote or remove an owner.** Ordering the two administrative roles is
// a policy change, not this guard, and is deliberately left undone — the guard below only makes
// the *ownerless* organisation impossible, not the impolite demotion.

export function registerOrgMembersRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  app.get('/v1/org/members', async (c) => {
    const auth = c.get('auth')
    const [roster, viewerRole] = await Promise.all([
      readRoster(deps.pool, auth.tenantId),
      viewerRoleOf(deps.pool, auth.tenantId, auth.userId)
    ])
    return c.json(toResponse(roster, viewerRole))
  })

  app.post('/v1/org/invites', async (c) => {
    const auth = c.get('auth')
    if ((await viewerRoleOf(deps.pool, auth.tenantId, auth.userId)) === 'member') {
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
    if ((await viewerRoleOf(deps.pool, auth.tenantId, auth.userId)) === 'member') {
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
    if ((await viewerRoleOf(deps.pool, auth.tenantId, auth.userId)) === 'member') {
      return c.json({ error: 'forbidden' }, 403)
    }
    const body = await parsed(c, OrgMemberRoleInputSchema)
    if (!body.ok) return body.response
    // Why 400 and not 403: it is the request that is wrong, not the caller — an admin who could
    // demote themselves could lock the organisation out one click at a time.
    if (body.data.userId === auth.userId) return c.json({ error: 'cannot_change_own_role' }, 400)
    const outcome = await changeMemberRole(deps.pool, auth.tenantId, body.data.userId, body.data.role)
    if (outcome === 'not_found') return c.json({ error: 'not_found' }, 404)
    if (outcome === 'last_owner') return c.json({ error: 'last_owner' }, 409)
    return c.body(null, 204)
  })

  app.post('/v1/org/members/remove', async (c) => {
    const auth = c.get('auth')
    if ((await viewerRoleOf(deps.pool, auth.tenantId, auth.userId)) === 'member') {
      return c.json({ error: 'forbidden' }, 403)
    }
    const body = await parsed(c, OrgMemberRemoveInputSchema)
    if (!body.ok) return body.response
    if (body.data.userId === auth.userId) return c.json({ error: 'cannot_remove_self' }, 400)
    const outcome = await removeMember(deps.pool, auth.tenantId, body.data.userId)
    if (outcome === 'not_found') return c.json({ error: 'not_found' }, 404)
    if (outcome === 'last_owner') return c.json({ error: 'last_owner' }, 409)
    return c.body(null, 204)
  })
}
