import type pg from 'pg'
import { withTenant } from '@alicorn-cloud/control-plane-postgres'
import type {
  OrgMember,
  OrgMembersResponse,
  OrgPendingInvite,
  OrgRole,
  SeatKind
} from '@alicorn-cloud/control-plane-contract'

// The Alicorn organisation's membership (OP1). `org_roles` and `seats` carry forced RLS, so every
// statement here runs inside `withTenant` — a query that forgets it reads nothing rather than
// reading another organisation.
//
// Keycloak organisation sync — creating the KC organisation member and actually mailing the
// invite — lands with the identity plan (I5). Until then an invite is a row, consumed at the
// invitee's first sign-in by `syncIdentity`.

export type OrgRoster = { members: OrgMember[]; pendingInvites: OrgPendingInvite[] }

type MemberRow = { user_id: string; email: string; display_name: string | null; role: string; seat: string | null }

export function readRoster(pool: pg.Pool, tenantId: string): Promise<OrgRoster> {
  return withTenant(pool, tenantId, async (client) => {
    const members = await client.query<MemberRow>(
      `SELECT r.user_id, u.email, u.display_name, r.role, s.kind AS seat
         FROM org_roles r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN seats s ON s.tenant_id = r.tenant_id AND s.user_id = r.user_id
        ORDER BY u.email`
    )
    const invites = await client.query<{ email: string; role: string; seat: string; created_at: Date }>(
      `SELECT email, role, seat, created_at FROM org_invites ORDER BY email`
    )
    return {
      members: members.rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        ...(row.display_name ? { displayName: row.display_name } : {}),
        role: row.role as OrgRole,
        seat: (row.seat ?? 'builder') as SeatKind
      })),
      pendingInvites: invites.rows.map((row) => ({
        email: row.email,
        role: row.role as OrgPendingInvite['role'],
        seat: row.seat as SeatKind,
        createdAt: row.created_at.toISOString()
      }))
    }
  })
}

export function readViewerRole(pool: pg.Pool, tenantId: string, userId: string): Promise<OrgRole | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ role: string }>(`SELECT role FROM org_roles WHERE user_id = $1`, [userId])
    return (rows[0]?.role as OrgRole | undefined) ?? null
  })
}

export function toResponse(roster: OrgRoster, viewerRole: OrgRole): OrgMembersResponse {
  return { ...roster, viewerRole, canManageMembers: viewerRole !== 'member' }
}

export type InviteOutcome = 'invited' | 'already_member' | 'already_invited'

export function createInvite(
  pool: pg.Pool,
  tenantId: string,
  invitedBy: string,
  invite: { email: string; role: 'admin' | 'member'; seat: SeatKind }
): Promise<InviteOutcome> {
  return withTenant(pool, tenantId, async (client) => {
    const member = await client.query(
      `SELECT 1 FROM org_roles r JOIN users u ON u.id = r.user_id WHERE lower(u.email) = $1`,
      [invite.email]
    )
    if (member.rowCount) return 'already_member'
    const { rowCount } = await client.query(
      `INSERT INTO org_invites (tenant_id, email, role, seat, invited_by)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, email) DO NOTHING`,
      [tenantId, invite.email, invite.role, invite.seat, invitedBy]
    )
    return rowCount ? 'invited' : 'already_invited'
  })
}

export function revokeInvite(pool: pg.Pool, tenantId: string, email: string): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const { rowCount } = await client.query(`DELETE FROM org_invites WHERE email = $1`, [email])
    return (rowCount ?? 0) > 0
  })
}

export function changeMemberRole(pool: pg.Pool, tenantId: string, userId: string, role: OrgRole): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const { rowCount } = await client.query(`UPDATE org_roles SET role = $2 WHERE user_id = $1`, [userId, role])
    return (rowCount ?? 0) > 0
  })
}

// The seat goes with the membership: a seat row for someone who is no longer in the organisation
// would still resolve OP3's connectors for them.
export function removeMember(pool: pg.Pool, tenantId: string, userId: string): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const { rowCount } = await client.query(`DELETE FROM org_roles WHERE user_id = $1`, [userId])
    await client.query(`DELETE FROM seats WHERE user_id = $1`, [userId])
    return (rowCount ?? 0) > 0
  })
}
