/**
 * The issues on the PM board a project was imported from.
 *
 * Read on demand, never stored. An import deliberately leaves the tracker where it is, so the one
 * place these are wanted is the moment someone is writing a ticket *about* one — and at that moment
 * the live list is the only correct one. Caching it would recreate the mirror the import refuses.
 */
import React from 'react'
import type { PlaneIssue } from '../../../../../shared/plane-types'
import type { ProjectSource } from '../../../../../shared/alicorn/projects'

export type ProjectBoardIssues = {
  issues: PlaneIssue[]
  loading: boolean
  error: string | null
}

export function useProjectBoardIssues(
  source: ProjectSource | null,
  enabled: boolean
): ProjectBoardIssues {
  const [issues, setIssues] = React.useState<PlaneIssue[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const boardId = source?.provider === 'plane' ? source.boardId : null

  React.useEffect(() => {
    if (!enabled || !boardId) {
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const listed = await window.api?.plane?.listIssues({ projectId: boardId })
        if (cancelled || !listed) {
          return
        }
        if (listed.ok) {
          setIssues(listed.value)
        } else {
          setError(listed.error)
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
  }, [boardId, enabled])

  return { issues, loading, error }
}
