import type { Hono } from 'hono'
import {
  SeatConnectorInputSchema,
  SeatConnectorKindSchema
} from '@alicorn-cloud/control-plane-contract'
import type { ControlApiDeps, ControlApiEnv } from './app-env.js'
import { viewerRoleOf } from './org-members-repository.js'
import { deleteSeatConnector, putSeatConnector, readSeatConnectors } from './seat-connectors-repository.js'
import { readJsonBody } from './read-json-body.js'

/**
 * Seat-scoped MCP connectors (OP3). Three routes beyond OP1's enumerated five, because a seat that
 * scopes nothing scopes nothing: OP1 shipped the `seats` table for this and left the surface it
 * narrows to be built here.
 *
 * Two rules, both narrowings:
 *
 *  - **Writes are admin-only, reads are admin or the seat holder.** The plan said "admin or the
 *    seat holder" for both; a member that can author its own connector authors its own execution
 *    surface, which is the CLAUDE.md invariant *a member cannot loosen its own criteria* wearing a
 *    different hat. Reading what you may already run gives away nothing.
 *  - **The seat is the gate.** `me` with no resolvable user (local mode has no second principal, so
 *    no user to *be*) and any id with no seat row both answer `{ seat: null, connectors: [] }`.
 *    Never the organisation's set, never another seat's — an absent seat withholds, it never
 *    inherits.
 */
export function registerSeatConnectorsRoutes(app: Hono<ControlApiEnv>, deps: ControlApiDeps): void {
  const path = '/v1/org/seats/:userId/connectors'

  app.get(path, async (c) => {
    const auth = c.get('auth')
    // `me` is the runtime's question — "what may I run?" — and is the only form the desktop sends,
    // so a client never needs to know its own internal user id to be narrowed by its seat.
    const target = c.req.param('userId') === 'me' ? auth.userId : c.req.param('userId')
    if (!target) return c.json({ seat: null, connectors: [] })
    if (target !== auth.userId && (await viewerRoleOf(deps.pool, auth.tenantId, auth.userId)) === 'member') {
      return c.json({ error: 'forbidden' }, 403)
    }
    return c.json(await readSeatConnectors(deps.pool, auth.tenantId, target))
  })

  app.put(`${path}/:kind`, async (c) => {
    const auth = c.get('auth')
    if ((await viewerRoleOf(deps.pool, auth.tenantId, auth.userId)) === 'member') {
      return c.json({ error: 'forbidden' }, 403)
    }
    const kind = SeatConnectorKindSchema.safeParse(c.req.param('kind'))
    if (!kind.success) return c.json({ error: 'unknown_connector_kind' }, 404)
    const target = seatHolderParam(c.req.param('userId'), auth.userId)
    if (!target) return c.json({ error: 'not_found' }, 404)
    const body = await readJsonBody(c)
    if (!body.ok) return c.json({ error: 'invalid_body', issues: [] }, 400)
    const input = SeatConnectorInputSchema.safeParse(body.value)
    if (!input.success) return c.json({ error: 'invalid_body', issues: input.error.issues }, 400)
    const outcome = await putSeatConnector(deps.pool, auth.tenantId, {
      userId: target,
      kind: kind.data,
      server: input.data.server,
      updatedBy: auth.actor
    })
    if (outcome === 'no_seat') return c.json({ error: 'no_seat' }, 404)
    return c.body(null, 204)
  })

  app.delete(`${path}/:kind`, async (c) => {
    const auth = c.get('auth')
    if ((await viewerRoleOf(deps.pool, auth.tenantId, auth.userId)) === 'member') {
      return c.json({ error: 'forbidden' }, 403)
    }
    const kind = SeatConnectorKindSchema.safeParse(c.req.param('kind'))
    if (!kind.success) return c.json({ error: 'unknown_connector_kind' }, 404)
    const target = seatHolderParam(c.req.param('userId'), auth.userId)
    if (!target) return c.json({ error: 'not_found' }, 404)
    if (!(await deleteSeatConnector(deps.pool, auth.tenantId, target, kind.data))) {
      return c.json({ error: 'not_found' }, 404)
    }
    return c.body(null, 204)
  })
}

function seatHolderParam(param: string, viewerUserId: string | null): string | null {
  return param === 'me' ? viewerUserId : param
}
