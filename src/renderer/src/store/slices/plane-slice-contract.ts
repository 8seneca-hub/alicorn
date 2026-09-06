import type { PlaneConnectionStatus } from '../../../../shared/plane-types'

export type PlaneSlice = {
  planeStatus: PlaneConnectionStatus
  // Distinguishes "not connected" from "not asked yet", so the settings card
  // can show a check in progress rather than a false disconnected state.
  planeStatusChecked: boolean
  planeStatusContextKey: string | null
  checkPlaneConnection: () => Promise<void>
  connectPlane: (args: {
    baseUrl: string
    workspaceSlug: string
    apiKey: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  disconnectPlane: (args?: { connectionId?: string }) => Promise<void>
}

export const DISCONNECTED_PLANE_STATUS: PlaneConnectionStatus = {
  connected: false,
  viewer: null,
  connections: [],
  activeConnectionId: null
}
