/**
 * The PM side of an import: is a provider connected, and what boards does it have.
 *
 * Not what is *on* a board. An import brings the project across and leaves its issues in the tracker
 * they already live in, so there is nothing here that reads them.
 *
 * Plane only, for now, and shaped so a second provider is another branch rather than a rewrite —
 * Alicorn already carries Linear and Jira clients with the same connect/status/list trio.
 */
import React from 'react'
import type { PlaneProject } from '../../../../../shared/plane-types'

export type PlaneImportSource = {
  /** Null while the first status read is in flight. */
  connected: boolean | null
  projects: PlaneProject[]
  error: string | null
}

export function usePlaneImportSource(enabled: boolean): PlaneImportSource {
  const [connected, setConnected] = React.useState<boolean | null>(null)
  const [projects, setProjects] = React.useState<PlaneProject[]>([])
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    void (async () => {
      const plane = window.api?.plane
      if (!plane) {
        if (!cancelled) {
          setConnected(false)
        }
        return
      }
      try {
        const status = await plane.status()
        if (cancelled) {
          return
        }
        setConnected(status.connected)
        if (!status.connected) {
          return
        }
        const listed = await plane.listProjects()
        if (cancelled) {
          return
        }
        if (listed.ok) {
          setProjects(listed.value)
        } else {
          setError(listed.error)
        }
      } catch (cause) {
        if (!cancelled) {
          setConnected(false)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { connected, projects, error }
}
