import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  planeConnect,
  planeDisconnect,
  planeListProjects,
  planeSetDefaultProject,
  planeStatus
} from '@/runtime/runtime-plane-client'
import { DISCONNECTED_PLANE_STATUS, type PlaneSlice } from './plane-slice-contract'

export type { PlaneSlice } from './plane-slice-contract'

// Rises on every status read so a slow reply from a superseded runtime context
// cannot overwrite a newer one.
let statusReadGeneration = 0

export const createPlaneSlice: StateCreator<AppState, [], [], PlaneSlice> = (set, get) => ({
  planeStatus: DISCONNECTED_PLANE_STATUS,
  planeStatusChecked: false,
  planeStatusContextKey: null,

  checkPlaneConnection: async () => {
    const contextKey = getProviderRuntimeContextKey(get().settings)
    statusReadGeneration += 1
    const generation = statusReadGeneration
    if (get().planeStatusContextKey !== contextKey) {
      set({ planeStatusChecked: false })
    }
    try {
      const status = await planeStatus(get().settings)
      if (generation !== statusReadGeneration) {
        return
      }
      set({ planeStatus: status, planeStatusChecked: true, planeStatusContextKey: contextKey })
    } catch {
      if (generation !== statusReadGeneration) {
        return
      }
      // A failed status read is a disconnected workspace, not a stuck check.
      set({
        planeStatus: DISCONNECTED_PLANE_STATUS,
        planeStatusChecked: true,
        planeStatusContextKey: contextKey
      })
    }
  },

  connectPlane: async (args) => {
    const result = await planeConnect(get().settings, args)
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    statusReadGeneration += 1
    set({
      planeStatus: result.value,
      planeStatusChecked: true,
      planeStatusContextKey: getProviderRuntimeContextKey(get().settings)
    })
    return { ok: true }
  },

  setPlaneDefaultProject: async (args) => {
    const status = await planeSetDefaultProject(get().settings, args)
    set({ planeStatus: status, planeStatusChecked: true })
  },

  // Not cached here: the settings card reads projects once to populate a
  // picker, and a stale list there would offer a project that no longer exists.
  listPlaneProjects: async () => {
    const result = await planeListProjects(get().settings)
    return result.ok ? result.value : []
  },

  disconnectPlane: async (args) => {
    const status = await planeDisconnect(get().settings, args)
    statusReadGeneration += 1
    set({
      planeStatus: status,
      planeStatusChecked: true,
      planeStatusContextKey: getProviderRuntimeContextKey(get().settings)
    })
  }
})
