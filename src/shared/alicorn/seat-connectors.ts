// Hand-mirrored from cloud/packages/control-plane-contract/src/seat-connector.ts.
// Field names must stay identical — the desktop does not import the contract package, so a
// rename there is a silent break here.

export const SEAT_CONNECTOR_KINDS = ['gdrive', 'sharepoint'] as const
export type SeatConnectorKind = (typeof SEAT_CONNECTOR_KINDS)[number]
export type SeatKind = 'builder' | 'collaborator'

/** `env` holds variable *names*; the values come from the seat holder's own environment. */
export type SeatConnectorServer = {
  command: string
  args: string[]
  env: string[]
}

export type SeatConnector = {
  userId: string
  kind: SeatConnectorKind
  server: SeatConnectorServer
  updatedAt: string
}

/** `seat: null` is the fail-closed answer — no seat resolved, so nothing extra may run. */
export type SeatConnectorsResponse = {
  seat: SeatKind | null
  connectors: SeatConnector[]
}

export const EMPTY_SEAT_CONNECTORS: SeatConnectorsResponse = { seat: null, connectors: [] }
