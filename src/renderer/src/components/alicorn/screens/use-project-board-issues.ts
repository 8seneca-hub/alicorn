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
import { canListBoardIssues } from './pm-import-providers'

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
  const boardId = canListBoardIssues(source) ? (source?.boardId ?? null) : null
  // Without it Plane's client falls back to the bare sequence number, so an issue reads `113`
  // rather than `ALC-113` — and `ALC-113` is what a person types and what a task's source is
  // supposed to carry.
  const identifier = source?.identifier ?? ''

  React.useEffect(() => {
    if (!enabled || !boardId) {
      // A provider whose client has no per-board query says so, rather than listing a whole
      // workspace and calling it this board's — that looks like it worked and hands back the
      // wrong ticket.
      if (enabled && source && !canListBoardIssues(source)) {
        setError('issues_not_scoped_for_provider')
      }
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const listed = await window.api?.plane?.listIssues({
          projectId: boardId,
          ...(identifier ? { projectIdentifier: identifier } : {})
        })
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
  }, [boardId, enabled, identifier, source])

  return { issues, loading, error }
}
