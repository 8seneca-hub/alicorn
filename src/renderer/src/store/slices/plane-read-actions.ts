import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { planeListIssues, planeListProjects, planeListStates } from '@/runtime/runtime-plane-client'
import {
  evictStaleCacheEntries,
  isFreshCacheEntry,
  looksLikeProviderAuthError
} from '../provider-read-cache'
import type { PlaneProject } from '../../../../shared/plane-types'
import type {
  PlaneProjectData,
  PlaneSlice,
  PlaneSliceGet,
  PlaneSliceSet
} from './plane-slice-contract'

// Rises on connect, disconnect and every explicit refresh, so a read in flight
// when the connection changed cannot write its result over the new one.
let readGeneration = 0

export function bumpPlaneReadGeneration(): void {
  readGeneration += 1
}

type PlaneReadActions = Pick<
  PlaneSlice,
  'loadPlaneProjects' | 'loadPlaneProject' | 'selectPlaneProject'
>

// Cache keys carry the runtime context and the connection: the same project id
// on two hosts, or under two workspaces, is not the same data.
function projectsKey(contextKey: string, connectionId: string): string {
  return `${contextKey}::${connectionId}`
}

function projectKey(contextKey: string, connectionId: string, projectId: string): string {
  return `${projectsKey(contextKey, connectionId)}::${projectId}`
}

function activeConnectionId(get: PlaneSliceGet): string | null {
  return get().planeStatus.activeConnectionId ?? null
}

export function createPlaneReadActions(set: PlaneSliceSet, get: PlaneSliceGet): PlaneReadActions {
  function fail(error: string): void {
    set({
      planeLoading: false,
      planeError: error,
      // An auth failure is a connection problem, not a read problem: force a
      // status recheck rather than leaving a stale list on screen.
      ...(looksLikeProviderAuthError(error) ? { planeStatusChecked: false } : {})
    })
  }

  return {
    selectPlaneProject: (projectId) => {
      bumpPlaneReadGeneration()
      set({ selectedPlaneProjectId: projectId, planeError: null })
    },

    loadPlaneProjects: async (options) => {
      const connectionId = activeConnectionId(get)
      if (!connectionId) {
        return
      }
      const contextKey = getProviderRuntimeContextKey(get().settings)
      const key = projectsKey(contextKey, connectionId)
      if (!options?.force && isFreshCacheEntry(get().planeProjectsCache[key])) {
        return
      }
      const generation = ++readGeneration
      set({ planeLoading: true })
      const result = await planeListProjects(get().settings, { connectionId })
      if (generation !== readGeneration) {
        return
      }
      if (!result.ok) {
        fail(result.error)
        return
      }
      const connection = get().planeStatus.connections?.find((entry) => entry.id === connectionId)
      set((state) => ({
        planeLoading: false,
        planeError: null,
        planeProjectsCache: evictStaleCacheEntries({
          ...state.planeProjectsCache,
          [key]: { data: result.value, fetchedAt: Date.now() }
        }),
        // The connection's default project wins; otherwise land on the first so
        // the list has something to show without a second interaction.
        selectedPlaneProjectId:
          state.selectedPlaneProjectId ??
          connection?.defaultProjectId ??
          result.value[0]?.id ??
          null
      }))
    },

    loadPlaneProject: async (projectId, options) => {
      const connectionId = activeConnectionId(get)
      if (!connectionId || !projectId) {
        return
      }
      const contextKey = getProviderRuntimeContextKey(get().settings)
      const key = projectKey(contextKey, connectionId, projectId)
      if (!options?.force && isFreshCacheEntry(get().planeProjectCache[key])) {
        return
      }
      const generation = ++readGeneration
      set({ planeLoading: true })
      const identifier = findIdentifier(get, contextKey, connectionId, projectId)
      // States and issues are fetched together: the list groups by state, so a
      // list without its states would render every issue as ungrouped.
      const [issues, states] = await Promise.all([
        planeListIssues(get().settings, {
          projectId,
          connectionId,
          ...(identifier ? { projectIdentifier: identifier } : {})
        }),
        planeListStates(get().settings, { projectId, connectionId })
      ])
      if (generation !== readGeneration) {
        return
      }
      if (!issues.ok) {
        fail(issues.error)
        return
      }
      if (!states.ok) {
        fail(states.error)
        return
      }
      const data: PlaneProjectData = { issues: issues.value, states: states.value }
      set((state) => ({
        planeLoading: false,
        planeError: null,
        planeProjectCache: evictStaleCacheEntries({
          ...state.planeProjectCache,
          [key]: { data, fetchedAt: Date.now() }
        })
      }))
    }
  }
}

function findIdentifier(
  get: PlaneSliceGet,
  contextKey: string,
  connectionId: string,
  projectId: string
): string | undefined {
  const projects: PlaneProject[] =
    get().planeProjectsCache[projectsKey(contextKey, connectionId)]?.data ?? []
  return projects.find((project) => project.id === projectId)?.identifier || undefined
}
