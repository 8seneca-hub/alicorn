import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
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
      const status = await window.api.plane.status()
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
    const result = await window.api.plane.connect(args)
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

  disconnectPlane: async (args) => {
    const status = await window.api.plane.disconnect(args)
    statusReadGeneration += 1
    set({
      planeStatus: status,
      planeStatusChecked: true,
      planeStatusContextKey: getProviderRuntimeContextKey(get().settings)
    })
  }
})
