/**
 * The project's workflows, and the one currently being read.
 *
 * Two calls, deliberately: `listWorkflows` answers which workflows a project has, and only
 * `getWorkflow` carries their stages. The summary's `stageCount` is not enough for a screen that
 * has to say what each stage requires.
 *
 * `workflow` is the selected one and defaults to the first, so a caller that only ever wants "the
 * project's workflow" — the task header's rail, the composer's stage picker — reads it and never
 * has to know a project may hold several.
 */
import React from 'react'
import type { Workflow, WorkflowSummary } from '../../../../../shared/alicorn/workflows'

export type ProjectWorkflowState = {
  /** Every workflow the project holds, newest read first. */
  workflows: WorkflowSummary[]
  workflow: Workflow | null
  /** Null until the read settles; a string when the control plane refused. */
  error: string | null
  loading: boolean
  select: (id: string) => void
  reload: () => void
}

export function useProjectWorkflow(
  projectId: string,
  /** Open this one rather than the first — a task names the workflow it runs under. */
  preferredId?: string | null
): ProjectWorkflowState {
  const [workflows, setWorkflows] = React.useState<WorkflowSummary[]>([])
  const [workflow, setWorkflow] = React.useState<Workflow | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [reloads, setReloads] = React.useState(0)

  // Reset during render rather than in an effect: an effect clears after the paint, which shows the
  // previous project's workflow for a frame.
  const [loadedProjectId, setLoadedProjectId] = React.useState(projectId)
  if (loadedProjectId !== projectId) {
    setLoadedProjectId(projectId)
    setSelectedId(null)
    setWorkflow(null)
  }

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
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
        setWorkflows([])
        setLoading(false)
        return
      }
      setWorkflows(listed.workflows)
      // A selection that survived a reload wins, then the caller's preference, then the first —
      // which is what a caller that names neither gets.
      const open =
        listed.workflows.find((candidate) => candidate.id === selectedId) ??
        listed.workflows.find((candidate) => candidate.id === preferredId) ??
        listed.workflows[0]
      if (!open) {
        setWorkflow(null)
        setLoading(false)
        return
      }
      const full = await get(open.id)
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
  }, [preferredId, projectId, selectedId, reloads])

  return {
    workflows,
    workflow,
    error,
    loading,
    select: setSelectedId,
    reload: () => setReloads((count) => count + 1)
  }
}
