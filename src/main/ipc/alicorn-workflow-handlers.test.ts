import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

import { registerAlicornWorkflowHandlers } from './alicorn-workflow-handlers'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import {
  ControlPlaneRequestError,
  ControlPlaneUnavailableError
} from '../alicorn/control-plane-http'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import type { WorkflowGraphInput } from '../../shared/alicorn/workflows'

const GRAPH: WorkflowGraphInput = {
  projectId: 'p1',
  name: 'Feature delivery',
  stages: [
    {
      key: 'build',
      name: 'Build',
      ordinal: 0,
      memberId: null,
      columnId: null,
      kind: 'worker',
      codeCommand: null,
      reversibility: 'contained',
      inheritedCost: 'low',
      requiredChecks: []
    }
  ],
  transitions: []
}

const WORKFLOW = { id: 'w1', version: 2, ...GRAPH }

function register(
  overrides: Partial<ControlPlaneClient> = {}
): Record<string, ReturnType<typeof vi.fn>> {
  const client = {
    listWorkflows: vi.fn().mockResolvedValue([]),
    getWorkflow: vi.fn().mockResolvedValue(WORKFLOW),
    listWorkflowTemplates: vi.fn().mockResolvedValue([]),
    createWorkflow: vi.fn().mockResolvedValue(WORKFLOW),
    updateWorkflow: vi.fn().mockResolvedValue(WORKFLOW),
    createWorkflowFromTemplate: vi.fn().mockResolvedValue(WORKFLOW),
    ...overrides
  }
  handlers.clear()
  registerAlicornWorkflowHandlers({ client: client as unknown as ControlPlaneClient })
  return client as unknown as Record<string, ReturnType<typeof vi.fn>>
}

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler({}, args)
}

describe('workflow reads', () => {
  it('lists the workflows of one project', async () => {
    const client = register({ listWorkflows: vi.fn().mockResolvedValue([{ id: 'w1' }]) })
    await expect(invoke(ALICORN_IPC.workflowsList, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      workflows: [{ id: 'w1' }]
    })
    expect(client.listWorkflows).toHaveBeenCalledWith('p1')
  })

  it('refuses a list with no project rather than asking for every workflow', async () => {
    const client = register()
    await expect(invoke(ALICORN_IPC.workflowsList, {})).resolves.toEqual({
      ok: false,
      error: 'invalid_body'
    })
    expect(client.listWorkflows).not.toHaveBeenCalled()
  })

  it('reads one workflow and the shipped templates', async () => {
    register({ listWorkflowTemplates: vi.fn().mockResolvedValue([{ key: 'feature-delivery' }]) })
    await expect(invoke(ALICORN_IPC.workflowGet, { id: 'w1' })).resolves.toEqual({
      ok: true,
      workflow: WORKFLOW
    })
    await expect(invoke(ALICORN_IPC.workflowTemplatesList)).resolves.toEqual({
      ok: true,
      templates: [{ key: 'feature-delivery' }]
    })
  })
})

describe('workflow writes', () => {
  it('creates a graph and passes it through untouched', async () => {
    const client = register()
    await expect(invoke(ALICORN_IPC.workflowCreate, { graph: GRAPH })).resolves.toEqual({
      ok: true,
      workflow: WORKFLOW
    })
    expect(client.createWorkflow).toHaveBeenCalledWith(GRAPH)
  })

  it('sends the loaded version with an update, so a second editor is noticed', async () => {
    const client = register()
    await invoke(ALICORN_IPC.workflowUpdate, { id: 'w1', version: 2, graph: GRAPH })
    expect(client.updateWorkflow).toHaveBeenCalledWith('w1', 2, GRAPH)
  })

  it('surfaces a version conflict as a result the canvas can render', async () => {
    register({
      updateWorkflow: vi
        .fn()
        .mockRejectedValue(new ControlPlaneRequestError(409, 'version_conflict'))
    })
    await expect(
      invoke(ALICORN_IPC.workflowUpdate, { id: 'w1', version: 1, graph: GRAPH })
    ).resolves.toEqual({ ok: false, error: 'version_conflict' })
  })

  // The Control API owns what a legal graph is; this only stops a payload that is not one at all.
  it('refuses an update with no version and a create with no stages array', async () => {
    const client = register()
    await expect(invoke(ALICORN_IPC.workflowUpdate, { id: 'w1', graph: GRAPH })).resolves.toEqual({
      ok: false,
      error: 'invalid_body'
    })
    await expect(
      invoke(ALICORN_IPC.workflowCreate, { graph: { projectId: 'p1', name: 'x' } })
    ).resolves.toEqual({ ok: false, error: 'invalid_body' })
    expect(client.updateWorkflow).not.toHaveBeenCalled()
    expect(client.createWorkflow).not.toHaveBeenCalled()
  })

  it('instantiates a template, omitting the name when none was given', async () => {
    const client = register()
    await invoke(ALICORN_IPC.workflowCreateFromTemplate, {
      projectId: 'p1',
      templateKey: 'feature-delivery'
    })
    expect(client.createWorkflowFromTemplate).toHaveBeenCalledWith({
      projectId: 'p1',
      templateKey: 'feature-delivery'
    })
  })
})

describe('control plane trouble', () => {
  it('answers unconfigured rather than throwing when there is no client', async () => {
    handlers.clear()
    registerAlicornWorkflowHandlers({ client: null })
    await expect(invoke(ALICORN_IPC.workflowsList, { projectId: 'p1' })).resolves.toEqual({
      ok: false,
      error: 'control_plane_unconfigured'
    })
  })

  it('answers with the unavailable code rather than rejecting the invoke', async () => {
    register({
      getWorkflow: vi
        .fn()
        .mockRejectedValue(new ControlPlaneUnavailableError('control_plane_unreachable'))
    })
    await expect(invoke(ALICORN_IPC.workflowGet, { id: 'w1' })).resolves.toEqual({
      ok: false,
      error: 'control_plane_unreachable'
    })
  })
})
