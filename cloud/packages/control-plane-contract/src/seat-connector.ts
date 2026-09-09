import { z } from 'zod'
import { SeatKindSchema } from './org.js'

/**
 * Seat-scoped MCP connectors (OP3). A connector belongs to *one seat*, never to the organisation:
 * a collaborator seat is a narrower execution surface, and the expensive mistake is a collaborator
 * resolving a connector a builder was meant to hold. Everything here is therefore keyed by the
 * internal `users.id` of the seat holder and resolves only when that seat exists.
 */
export const SEAT_CONNECTOR_KINDS = ['gdrive', 'sharepoint'] as const
export const SeatConnectorKindSchema = z.enum(SEAT_CONNECTOR_KINDS)

/**
 * Env is a list of variable *names*, never values (plan Decision 5). The shape is the enforcement:
 * a name-shaped, upper-snake, 64-char token is a poor container for a token or a refresh secret,
 * and the materialiser emits `${NAME}` so the value can only ever come from the seat holder's own
 * process environment at launch.
 */
const EnvNameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/)

export const SeatConnectorServerSchema = z.object({
  command: z.string().trim().min(1).max(200),
  args: z.array(z.string().max(500)).max(20).default([]),
  env: z.array(EnvNameSchema).max(20).default([])
})

export const SeatConnectorSchema = z.object({
  userId: z.string().min(1),
  kind: SeatConnectorKindSchema,
  server: SeatConnectorServerSchema,
  updatedAt: z.string().datetime()
})

/**
 * `seat` is null when the caller has no seat — local mode (no user to be), a membership that was
 * removed, or an id that never had one. Connectors are then empty by construction, which is the
 * fail-closed answer: an unresolvable seat withholds a connector, it never inherits one.
 */
export const SeatConnectorsResponseSchema = z.object({
  seat: SeatKindSchema.nullable(),
  connectors: z.array(SeatConnectorSchema)
})

export const SeatConnectorInputSchema = z.object({ server: SeatConnectorServerSchema })

export type SeatConnectorKind = z.infer<typeof SeatConnectorKindSchema>
export type SeatConnectorServer = z.infer<typeof SeatConnectorServerSchema>
export type SeatConnector = z.infer<typeof SeatConnectorSchema>
export type SeatConnectorsResponse = z.infer<typeof SeatConnectorsResponseSchema>
export type SeatConnectorInput = z.infer<typeof SeatConnectorInputSchema>
