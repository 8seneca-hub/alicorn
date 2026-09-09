import { z } from 'zod'

/**
 * The Alicorn organisation (OP1). Not Orca's relay-backed account org — the two never share a
 * code path, a route namespace or a name; see CLAUDE.md.
 *
 * The wire shape is deliberately the one `profile-cloud-org-members-client.ts` already speaks
 * (plan Decision 4), so the desktop's roster rendering and error mapping are already written.
 */
export const ORG_ROLES = ['owner', 'admin', 'member'] as const
export const SEAT_KINDS = ['builder', 'collaborator'] as const

export const OrgRoleSchema = z.enum(ORG_ROLES)
/** An invite can never mint an owner: ownership is held, transferred or bootstrapped, not mailed. */
export const InvitableRoleSchema = z.enum(['admin', 'member'])
export const SeatKindSchema = z.enum(SEAT_KINDS)

const EmailSchema = z.string().trim().toLowerCase().email().max(320)

export const OrgMemberSchema = z.object({
  userId: z.string().min(1),
  email: z.string(),
  displayName: z.string().optional(),
  role: OrgRoleSchema,
  seat: SeatKindSchema
})

export const OrgPendingInviteSchema = z.object({
  email: z.string(),
  role: InvitableRoleSchema,
  seat: SeatKindSchema,
  createdAt: z.string().datetime()
})

export const OrgMembersResponseSchema = z.object({
  members: z.array(OrgMemberSchema),
  pendingInvites: z.array(OrgPendingInviteSchema),
  viewerRole: OrgRoleSchema,
  canManageMembers: z.boolean()
})

/** A seat is what a membership may *run*; the role is what it may *administer*. */
export const SeatSchema = z.object({ userId: z.string().min(1), kind: SeatKindSchema })

export const OrgInviteInputSchema = z.object({
  email: EmailSchema,
  role: InvitableRoleSchema,
  seat: SeatKindSchema.default('builder')
})
export const OrgInviteRevokeInputSchema = z.object({ email: EmailSchema })
export const OrgMemberRoleInputSchema = z.object({ userId: z.string().trim().min(1).max(120), role: OrgRoleSchema })
export const OrgMemberRemoveInputSchema = z.object({ userId: z.string().trim().min(1).max(120) })

export type OrgRole = z.infer<typeof OrgRoleSchema>
export type SeatKind = z.infer<typeof SeatKindSchema>
export type OrgMember = z.infer<typeof OrgMemberSchema>
export type OrgPendingInvite = z.infer<typeof OrgPendingInviteSchema>
export type OrgMembersResponse = z.infer<typeof OrgMembersResponseSchema>
export type Seat = z.infer<typeof SeatSchema>
export type OrgInviteInput = z.infer<typeof OrgInviteInputSchema>
