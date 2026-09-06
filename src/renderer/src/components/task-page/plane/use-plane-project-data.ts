import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/store'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import type { PlaneIssue, PlaneState } from '../../../../../shared/plane-types'

/**
 * The selected project's issues and states.
 *
 * Plane's v1 API has no cross-project issue list, so the Tasks page is always
 * scoped to one project — the connection's default until the user picks another.
 */
export function usePlaneProjectData(connected: boolean): {
  issues: PlaneIssue[]
  states: PlaneState[]
  refresh: () => Promise<void>
} {
  const settings = useAppStore((s) => s.settings)
  const status = useAppStore((s) => s.planeStatus)
  const projectCache = useAppStore((s) => s.planeProjectCache)
  const selectedProjectId = useAppStore((s) => s.selectedPlaneProjectId)
  const loadPlaneProjects = useAppStore((s) => s.loadPlaneProjects)
  const loadPlaneProject = useAppStore((s) => s.loadPlaneProject)

  const connectionId = status.activeConnectionId ?? null
  const contextKey = getProviderRuntimeContextKey(settings)
  const key =
    connectionId && selectedProjectId
      ? `${contextKey}::${connectionId}::${selectedProjectId}`
      : null
  const entry = key ? projectCache[key] : undefined

  useEffect(() => {
    if (connected) {
      void loadPlaneProjects()
    }
  }, [connected, loadPlaneProjects])

  useEffect(() => {
    if (connected && selectedProjectId) {
      void loadPlaneProject(selectedProjectId)
    }
  }, [connected, selectedProjectId, loadPlaneProject])

  const refresh = useCallback(async () => {
    await loadPlaneProjects({ force: true })
    if (selectedProjectId) {
      await loadPlaneProject(selectedProjectId, { force: true })
    }
  }, [loadPlaneProjects, loadPlaneProject, selectedProjectId])

  return {
    issues: entry?.data?.issues ?? [],
    states: entry?.data?.states ?? [],
    refresh
  }
}
