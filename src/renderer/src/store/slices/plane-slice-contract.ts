import type { StoreApi } from 'zustand'
import type { AppState } from '../types'
import type { CacheEntry } from '../github/cache-model'
import type {
  PlaneConnectionStatus,
  PlaneIssue,
  PlaneProject,
  PlaneState
} from '../../../../shared/plane-types'

// States and issues are cached as one unit: the list groups issues by state, so
// a project is only readable when both have arrived.
export type PlaneProjectData = {
  issues: PlaneIssue[]
  states: PlaneState[]
}

export type PlaneSliceSet = StoreApi<AppState>['setState']
export type PlaneSliceGet = StoreApi<AppState>['getState']

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
  setPlaneDefaultProject: (args: {
    connectionId: string
    projectId: string | null
  }) => Promise<void>
  listPlaneProjects: () => Promise<PlaneProject[]>
  planeProjectsCache: Record<string, CacheEntry<PlaneProject[]>>
  planeProjectCache: Record<string, CacheEntry<PlaneProjectData>>
  planeLoading: boolean
  planeError: string | null
  selectedPlaneProjectId: string | null
  loadPlaneProjects: (options?: { force?: boolean }) => Promise<void>
  loadPlaneProject: (projectId: string, options?: { force?: boolean }) => Promise<void>
  selectPlaneProject: (projectId: string | null) => void
}

export const DISCONNECTED_PLANE_STATUS: PlaneConnectionStatus = {
  connected: false,
  viewer: null,
  connections: [],
  activeConnectionId: null
}

export const EMPTY_PLANE_READ_CACHES = {
  planeProjectsCache: {},
  planeProjectCache: {},
  planeError: null,
  planeLoading: false,
  selectedPlaneProjectId: null
} as const
