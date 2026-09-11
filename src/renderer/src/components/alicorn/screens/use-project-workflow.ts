/**
 * The project's workflow, stages included.
 *
 * Two calls, deliberately: `listWorkflows` answers which workflow a project has, and only
 * `getWorkflow` carries its stages. The summary's `stageCount` is not enough for the overview,
 * which has to say what each stage requires.
 */
import React from 'react'
import type { Workflow } from '../../../../../shared/alicorn/workflows'

export type ProjectWorkflowState = {
  workflow: Workflow | null
  /** Null until the read settles; a string when the control plane refused. */
  error: string | null
  loading: boolean
}

export function useProjectWorkflow(projectId: string): ProjectWorkflowState {
  const [workflow, setWorkflow] = React.useState<Workflow | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setWorkflow(null)
    setError(null)
    void (async () => {
      const list = window.api?.alicorn?.listWorkflows
      const get = window.api?.alicorn?.getWorkflow
      if (!list || !get) {
        if (!cancelled) {
          setError('control_plane_unreachable')
          setLoading(false)
        }
        return
      }
      const listed = await list(projectId)
      if (cancelled) {
        return
      }
      if (!listed.ok) {
        setError(listed.error)
        setLoading(false)
        return
      }
      const first = listed.workflows[0]
      if (!first) {
        setLoading(false)
        return
      }
      const full = await get(first.id)
      if (cancelled) {
        return
      }
      if (full.ok) {
        setWorkflow(full.workflow)
      } else {
        setError(full.error)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  return { workflow, error, loading }
}
