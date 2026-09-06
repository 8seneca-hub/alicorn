import { ipcMain } from 'electron'
import {
  connectPlane,
  disconnectPlane,
  getActiveClient,
  getClientById,
  getPlaneStatus
} from '../plane/plane-connection'
import {
  listProjectStates,
  listProjects,
  listWorkspaceMembers
} from '../plane/plane-project-queries'
import { getProjectIssue, listProjectIssues } from '../plane/plane-issue-queries'
import type { PlaneClient } from '../plane/plane-request'
import type {
  PlaneConnectionStatus,
  PlaneIssue,
  PlaneMember,
  PlaneProject,
  PlaneState
} from '../../shared/plane-types'

export type PlaneResult<T> = { ok: true; value: T } | { ok: false; error: string }

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Every read is wrapped so a transport or credential failure reaches the
// renderer as a message it can show, not an unhandled IPC rejection.
async function attempt<T>(run: () => Promise<T> | T): Promise<PlaneResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// A read names its connection explicitly or falls back to the active one, so a
// list started before a connection switch cannot resolve against the new key.
function resolveClient(connectionId: unknown): PlaneClient | null {
  const id = optionalString(connectionId)
  return id ? getClientById(id) : getActiveClient()
}

async function withClient<T>(
  connectionId: unknown,
  run: (client: PlaneClient) => Promise<T>
): Promise<PlaneResult<T>> {
  const client = resolveClient(connectionId)
  if (!client) {
    return { ok: false, error: 'No Plane workspace is connected.' }
  }
  return attempt(() => run(client))
}

/** Registers every `plane:*` IPC handler on the main process. */
export function registerPlaneHandlers(): void {
  ipcMain.handle(
    'plane:connect',
    async (
      _event,
      args: { baseUrl?: unknown; workspaceSlug?: unknown; apiKey?: unknown }
    ): Promise<PlaneResult<PlaneConnectionStatus>> => {
      const baseUrl = optionalString(args?.baseUrl)
      const workspaceSlug = optionalString(args?.workspaceSlug)
      const apiKey = optionalString(args?.apiKey)
      if (!baseUrl || !workspaceSlug || !apiKey) {
        return { ok: false, error: 'Plane URL, workspace slug, and API key are required.' }
      }
      return attempt(() => connectPlane({ baseUrl, workspaceSlug, apiKey }))
    }
  )

  ipcMain.handle(
    'plane:disconnect',
    async (_event, args?: { connectionId?: unknown }): Promise<PlaneConnectionStatus> =>
      disconnectPlane(optionalString(args?.connectionId))
  )

  ipcMain.handle('plane:status', async (): Promise<PlaneConnectionStatus> => getPlaneStatus())

  ipcMain.handle(
    'plane:listProjects',
    async (_event, args?: { connectionId?: unknown }): Promise<PlaneResult<PlaneProject[]>> =>
      withClient(args?.connectionId, (client) => listProjects(client))
  )

  ipcMain.handle(
    'plane:listStates',
    async (
      _event,
      args: { projectId?: unknown; connectionId?: unknown }
    ): Promise<PlaneResult<PlaneState[]>> => {
      const projectId = optionalString(args?.projectId)
      if (!projectId) {
        return { ok: false, error: 'A Plane project id is required.' }
      }
      return withClient(args?.connectionId, (client) => listProjectStates(client, projectId))
    }
  )

  ipcMain.handle(
    'plane:listMembers',
    async (_event, args?: { connectionId?: unknown }): Promise<PlaneResult<PlaneMember[]>> =>
      withClient(args?.connectionId, (client) => listWorkspaceMembers(client))
  )

  ipcMain.handle(
    'plane:listIssues',
    async (
      _event,
      args: {
        projectId?: unknown
        projectIdentifier?: unknown
        orderBy?: unknown
        connectionId?: unknown
      }
    ): Promise<PlaneResult<PlaneIssue[]>> => {
      const projectId = optionalString(args?.projectId)
      if (!projectId) {
        return { ok: false, error: 'A Plane project id is required.' }
      }
      const projectIdentifier = optionalString(args?.projectIdentifier)
      const orderBy = optionalString(args?.orderBy)
      return withClient(args?.connectionId, (client) =>
        listProjectIssues(client, projectId, {
          ...(projectIdentifier ? { projectIdentifier } : {}),
          ...(orderBy ? { orderBy } : {})
        })
      )
    }
  )

  ipcMain.handle(
    'plane:getIssue',
    async (
      _event,
      args: {
        projectId?: unknown
        issueId?: unknown
        projectIdentifier?: unknown
        connectionId?: unknown
      }
    ): Promise<PlaneResult<PlaneIssue | null>> => {
      const projectId = optionalString(args?.projectId)
      const issueId = optionalString(args?.issueId)
      if (!projectId || !issueId) {
        return { ok: false, error: 'A Plane project id and issue id are required.' }
      }
      const projectIdentifier = optionalString(args?.projectIdentifier)
      return withClient(args?.connectionId, (client) =>
        getProjectIssue(client, projectId, issueId, projectIdentifier ? { projectIdentifier } : {})
      )
    }
  )
}
