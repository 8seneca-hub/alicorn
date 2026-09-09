import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type {
  SeatConnector,
  SeatConnectorKind,
  SeatConnectorServer,
  SeatConnectorsResponse,
  SeatKind
} from '@alicorn-cloud/control-plane-contract'

// Seat-scoped MCP connectors (OP3). `seats` and `seat_connectors` both carry forced RLS, so every
// statement runs inside `withTenant` — a query that forgets it reads nothing rather than another
// organisation's connectors.

export function readSeatKind(pool: pg.Pool, tenantId: string, userId: string): Promise<SeatKind | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ kind: string }>(`SELECT kind FROM seats WHERE user_id = $1`, [userId])
    return (rows[0]?.kind as SeatKind | undefined) ?? null
  })
}

/**
 * What this seat may run, and nothing else. The seat is read in the same transaction as the
 * connectors so a membership removed mid-call cannot answer with a seat's set after its seat is
 * gone; with no seat the answer is `{ seat: null, connectors: [] }`, never a wider default.
 */
export function readSeatConnectors(
  pool: pg.Pool,
  tenantId: string,
  userId: string
): Promise<SeatConnectorsResponse> {
  return withTenant(pool, tenantId, async (client) => {
    const seat = await client.query<{ kind: string }>(`SELECT kind FROM seats WHERE user_id = $1`, [userId])
    if (!seat.rowCount) return { seat: null, connectors: [] }
    const { rows } = await client.query<{ kind: string; server: SeatConnectorServer; updated_at: Date }>(
      `SELECT kind, server, updated_at FROM seat_connectors WHERE user_id = $1 ORDER BY kind`,
      [userId]
    )
    return {
      seat: seat.rows[0]!.kind as SeatKind,
      connectors: rows.map((row) => ({
        userId,
        kind: row.kind as SeatConnectorKind,
        server: row.server,
        updatedAt: row.updated_at.toISOString()
      })) satisfies SeatConnector[]
    }
  })
}

export type SeatConnectorWriteOutcome = 'saved' | 'no_seat'

export function putSeatConnector(
  pool: pg.Pool,
  tenantId: string,
  input: { userId: string; kind: SeatConnectorKind; server: SeatConnectorServer; updatedBy: string }
): Promise<SeatConnectorWriteOutcome> {
  return withTenant(pool, tenantId, async (client) => {
    // The FK to `seats` would raise anyway; asking first turns a 500 into the 404 the route means.
    const seat = await client.query(`SELECT 1 FROM seats WHERE user_id = $1`, [input.userId])
    if (!seat.rowCount) return 'no_seat'
    await client.query(
      `INSERT INTO seat_connectors (tenant_id, user_id, kind, server, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, user_id, kind)
       DO UPDATE SET server = EXCLUDED.server, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, input.userId, input.kind, JSON.stringify(input.server), input.updatedBy]
    )
    return 'saved'
  })
}

export function deleteSeatConnector(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
  kind: SeatConnectorKind
): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const { rowCount } = await client.query(`DELETE FROM seat_connectors WHERE user_id = $1 AND kind = $2`, [
      userId,
      kind
    ])
    return (rowCount ?? 0) > 0
  })
}
