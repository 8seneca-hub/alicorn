import { ipcMain } from 'electron'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import {
  asNonEmptyString,
  attemptControlPlane as attempt,
  type AlicornFailure
} from './alicorn-control-plane-result'
import type {
  Workflow,
  WorkflowGraphInput,
  WorkflowSummary,
  WorkflowTemplate
} from '../../shared/alicorn/workflows'

export type WorkflowResult = { ok: true; workflow: Workflow } | AlicornFailure

/**
 * The canvas's reads and writes (WF2). Split from `alicorn-handlers` only for length.
 *
 * Nothing here re-validates the graph: `WorkflowInputSchema` on the Control API is the single
 * authority on what a legal workflow is, and a second copy in the main process would be one more
 * place for the two to disagree. This rejects only a payload that is not an object at all, so a
 * malformed invoke fails here rather than as a confusing 400.
 */
function asGraphInput(value: unknown): WorkflowGraphInput | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const graph = value as Partial<WorkflowGraphInput>
  if (!asNonEmptyString(graph.projectId)) {
    return null
  }
  if (!Array.isArray(graph.stages) || !Array.isArray(graph.transitions)) {
    return null
  }
  return graph as WorkflowGraphInput
}

export function registerAlicornWorkflowHandlers(deps: { client: ControlPlaneClient | null }): void {
  ipcMain.handle(
    ALICORN_IPC.workflowsList,
    async (
      _event,
      args: { projectId?: unknown }
    ): Promise<{ ok: true; workflows: WorkflowSummary[] } | AlicornFailure> => {
      const projectId = asNonEmptyString(args?.projectId)
      if (!projectId) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        workflows: await client.listWorkflows(projectId)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.workflowGet,
    async (_event, args: { id?: unknown }): Promise<WorkflowResult> => {
      const id = asNonEmptyString(args?.id)
      if (!id) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        workflow: await client.getWorkflow(id)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.workflowTemplatesList,
    async (): Promise<{ ok: true; templates: WorkflowTemplate[] } | AlicornFailure> =>
      attempt(deps.client, async (client) => ({
        ok: true as const,
        templates: await client.listWorkflowTemplates()
      }))
  )

  ipcMain.handle(
    ALICORN_IPC.workflowCreate,
    async (_event, args: { graph?: unknown }): Promise<WorkflowResult> => {
      const graph = asGraphInput(args?.graph)
      if (!graph) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        workflow: await client.createWorkflow(graph)
      }))
    }
  )

  // The version the canvas loaded rides along: a 409 `version_conflict` is how a second editor is
  // noticed, and losing that would make the last save silently win.
  ipcMain.handle(
    ALICORN_IPC.workflowUpdate,
    async (
      _event,
      args: { id?: unknown; version?: unknown; graph?: unknown }
    ): Promise<WorkflowResult> => {
      const id = asNonEmptyString(args?.id)
      const graph = asGraphInput(args?.graph)
      const version = args?.version
      if (!id || !graph || typeof version !== 'number' || !Number.isInteger(version)) {
        return { ok: false, error: 'invalid_body' }
      }
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        workflow: await client.updateWorkflow(id, version, graph)
      }))
    }
  )

  ipcMain.handle(
    ALICORN_IPC.workflowCreateFromTemplate,
    async (
      _event,
      args: { projectId?: unknown; templateKey?: unknown; name?: unknown }
    ): Promise<WorkflowResult> => {
      const projectId = asNonEmptyString(args?.projectId)
      const templateKey = asNonEmptyString(args?.templateKey)
      if (!projectId || !templateKey) {
        return { ok: false, error: 'invalid_body' }
      }
      const name = asNonEmptyString(args?.name)
      return attempt(deps.client, async (client) => ({
        ok: true as const,
        workflow: await client.createWorkflowFromTemplate({
          projectId,
          templateKey,
          ...(name ? { name } : {})
        })
      }))
    }
  )
}
