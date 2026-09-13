import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Member } from '../../../../../shared/alicorn/members'
import type { Workflow, WorkflowSummary } from '../../../../../shared/alicorn/workflows'
import {
  addStage,
  moveStage,
  patchStage,
  removeStage,
  removeTransition,
  renameStageKey,
  upsertTransition,
  type WorkflowDraft
} from './workflow-draft'
import { renamedStageKeys, validateDraft } from './workflow-draft-validation'

type Edit = (draft: WorkflowDraft) => WorkflowDraft

export type WorkflowEditor = ReturnType<typeof useWorkflowEditor>

function toDraft(workflow: Workflow): WorkflowDraft {
  return {
    projectId: workflow.projectId,
    name: workflow.name,
    stages: workflow.stages,
    transitions: workflow.transitions
  }
}

/**
 * Loading, editing and saving one workflow.
 *
 * The saved workflow is kept beside the draft for two reasons: the version has to ride along with
 * a save so a second editor is caught by the API's 409 rather than silently overwritten, and the
 * saved stage keys are what says whether a rename is throwing away a track record (SK1).
 */
export function useWorkflowEditor(projectId: string | null) {
  const [summaries, setSummaries] = useState<WorkflowSummary[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [saved, setSaved] = useState<Workflow | null>(null)
  const [draft, setDraft] = useState<WorkflowDraft | null>(null)
  // Why reset during render rather than in an effect: an effect clears these *after* the paint,
  // so switching project shows the previous project's workflow for a frame. React's documented
  // pattern for state derived from a prop is to adjust it while rendering.
  const [loadedProjectId, setLoadedProjectId] = useState(projectId)
  if (loadedProjectId !== projectId) {
    setLoadedProjectId(projectId)
    setSaved(null)
    setDraft(null)
  }
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!projectId) {
      return
    }
    setLoading(true)
    const [listed, roster] = await Promise.all([
      window.api.alicorn.listWorkflows(projectId),
      window.api.alicorn.listMembers()
    ])
    setLoading(false)
    // A missing roster is not a missing workflow: the canvas still draws, members read as unnamed.
    setMembers(roster.ok ? roster.members : [])
    if (!listed.ok) {
      setError(listed.error)
      setSummaries([])
      return
    }
    setError(null)
    setSummaries(listed.workflows)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const open = useCallback(async (id: string) => {
    const result = await window.api.alicorn.getWorkflow(id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setSaved(result.workflow)
    setDraft(toDraft(result.workflow))
  }, [])

  const edit = useCallback((change: Edit) => {
    setDraft((current) => (current ? change(current) : current))
  }, [])

  const save = useCallback(async () => {
    if (!draft) {
      return
    }
    setSaving(true)
    const result = saved
      ? await window.api.alicorn.updateWorkflow({
          id: saved.id,
          version: saved.version,
          graph: draft
        })
      : await window.api.alicorn.createWorkflow(draft)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setSaved(result.workflow)
    setDraft(toDraft(result.workflow))
    await load()
  }, [draft, saved, load])

  const issues = useMemo(() => (draft ? validateDraft(draft) : []), [draft])
  const renamedKeys = useMemo(
    () => (draft && saved ? renamedStageKeys(saved.stages, draft) : []),
    [draft, saved]
  )

  return {
    summaries,
    members,
    saved,
    draft,
    issues,
    /** Saved keys the draft dropped — each is a track record the renamed stage will not inherit. */
    renamedKeys,
    error,
    loading,
    saving,
    reload: load,
    open,
    save,
    setName: (name: string) => edit((current) => ({ ...current, name })),
    addStage: (key: string, afterOrdinal?: number) =>
      edit((current) => addStage(current, key, afterOrdinal)),
    patchStage: (key: string, patch: Parameters<typeof patchStage>[2]) =>
      edit((current) => patchStage(current, key, patch)),
    renameStage: (from: string, to: string) => edit((current) => renameStageKey(current, from, to)),
    moveStage: (key: string, delta: -1 | 1) => edit((current) => moveStage(current, key, delta)),
    removeStage: (key: string) => edit((current) => removeStage(current, key)),
    upsertTransition: (transition: Parameters<typeof upsertTransition>[1]) =>
      edit((current) => upsertTransition(current, transition)),
    removeTransition: (from: string, to: string) =>
      edit((current) => removeTransition(current, from, to))
  }
}
