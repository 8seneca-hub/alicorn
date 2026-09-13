/**
 * The PM side of an import: is a provider connected, what boards does it have, and what is on one.
 *
 * Plane only, for now, and shaped so a second provider is another branch rather than a rewrite —
 * Alicorn already carries Linear and Jira clients with the same connect/status/list trio. Everything
 * here is a read; nothing is created until the dialog says so.
 */
import React from 'react'
import type { PlaneIssue, PlaneProject, PlaneState } from '../../../../../shared/plane-types'
import { isOpenPlaneIssue } from '../../../../../shared/alicorn/pm-import'

export type PlaneImportBoard = {
  issues: PlaneIssue[]
  openIssues: PlaneIssue[]
  loading: boolean
  error: string | null
}

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

/** What one board holds, split into everything and what is still work. */
export function usePlaneImportBoard(projectId: string | null): PlaneImportBoard {
  const [issues, setIssues] = React.useState<PlaneIssue[]>([])
  const [states, setStates] = React.useState<PlaneState[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!projectId) {
      setIssues([])
      setStates([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      const plane = window.api?.plane
      if (!plane) {
        if (!cancelled) {
          setLoading(false)
        }
        return
      }
      try {
        // States come with the issues because "how many are still open" is the number the dialog
        // previews, and a state id alone cannot answer it.
        const [listedIssues, listedStates] = await Promise.all([
          plane.listIssues({ projectId }),
          plane.listStates({ projectId })
        ])
        if (cancelled) {
          return
        }
        if (listedIssues.ok) {
          setIssues(listedIssues.value)
        } else {
          setError(listedIssues.error)
        }
        if (listedStates.ok) {
          setStates(listedStates.value)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const openIssues = React.useMemo(
    () => issues.filter((issue) => isOpenPlaneIssue(issue, states)),
    [issues, states]
  )

  return { issues, openIssues, loading, error }
}
