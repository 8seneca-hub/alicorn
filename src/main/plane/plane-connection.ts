import type { PlaneConnection, PlaneConnectionStatus, PlaneProject } from '../../shared/plane-types'
import {
  connectionIdFor,
  deleteKey,
  getConnectionFile,
  normalizeBaseUrl,
  readKey,
  saveKey,
  writeConnectionFile
} from './plane-connection-store'
import { listProjects } from './plane-project-queries'
import { PlaneApiError, requestWithKey, workspacePath, type PlaneClient } from './plane-request'
import { asRecord } from './plane-record-pages'
import { CredentialDecryptionError } from '../integration-credential-file'

export type ConnectPlaneInput = {
  baseUrl: string
  workspaceSlug: string
  apiKey: string
}

function assertHttpsOrLoopback(baseUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new PlaneApiError('Plane URL must be a full URL, for example https://plane.example.com')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  // Why: the API key travels in a request header on every read; plain HTTP to a
  // non-loopback host would put a workspace-wide credential on the wire.
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new PlaneApiError('Plane URL must use HTTPS; local development may use loopback HTTP.')
  }
}

export function buildPlaneClient(connection: PlaneConnection, apiKey: string): PlaneClient {
  return {
    connectionId: connection.id,
    baseUrl: connection.baseUrl,
    workspaceSlug: connection.workspaceSlug,
    apiKey
  }
}

export function getActiveClient(): PlaneClient | null {
  const file = getConnectionFile()
  const connection = file.connections.find((candidate) => candidate.id === file.activeConnectionId)
  if (!connection) {
    return null
  }
  const apiKey = readKey(connection.id)
  return apiKey ? buildPlaneClient(connection, apiKey) : null
}

export function getClientById(connectionId: string): PlaneClient | null {
  const connection = getConnectionFile().connections.find(
    (candidate) => candidate.id === connectionId
  )
  if (!connection) {
    return null
  }
  const apiKey = readKey(connection.id)
  return apiKey ? buildPlaneClient(connection, apiKey) : null
}

// Plane has no "who am I" endpoint on the v1 API key surface, so the workspace
// projects list doubles as the credential probe: it is the narrowest read the
// key must be able to perform for the provider to be useful at all.
export async function connectPlane(input: ConnectPlaneInput): Promise<PlaneConnectionStatus> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const workspaceSlug = input.workspaceSlug.trim()
  const apiKey = input.apiKey.trim()
  assertHttpsOrLoopback(baseUrl)
  if (!workspaceSlug) {
    throw new PlaneApiError('A Plane workspace slug is required.')
  }
  if (!apiKey) {
    throw new PlaneApiError('A Plane API key is required.')
  }

  const probe = await requestWithKey<unknown>(
    baseUrl,
    apiKey,
    workspacePath(workspaceSlug, 'projects/')
  )
  if (!Array.isArray(asRecord(probe).results)) {
    throw new PlaneApiError(
      `No Plane workspace named "${workspaceSlug}" is reachable with this API key.`
    )
  }

  const id = connectionIdFor(baseUrl, workspaceSlug)
  const connection: PlaneConnection = {
    id,
    baseUrl,
    workspaceSlug,
    displayName: planeConnectionDisplayName(baseUrl, workspaceSlug)
  }
  // Save the key first: writeConnectionFile drops any connection without one.
  saveKey(id, apiKey)
  const file = getConnectionFile()
  writeConnectionFile({
    ...file,
    activeConnectionId: id,
    selectedConnectionId: id,
    connections: [...file.connections.filter((candidate) => candidate.id !== id), connection]
  })
  return getPlaneStatus()
}

export function disconnectPlane(connectionId?: string): PlaneConnectionStatus {
  const file = getConnectionFile()
  const targets = connectionId
    ? file.connections.filter((candidate) => candidate.id === connectionId)
    : file.connections
  for (const target of targets) {
    deleteKey(target.id)
  }
  writeConnectionFile({
    ...file,
    activeConnectionId: null,
    selectedConnectionId: null,
    connections: file.connections.filter(
      (candidate) => !targets.some((target) => target.id === candidate.id)
    )
  })
  return getPlaneStatus()
}

export function getPlaneStatus(): PlaneConnectionStatus {
  const file = getConnectionFile()
  const active = file.connections.find((candidate) => candidate.id === file.activeConnectionId)
  if (!active) {
    return {
      connected: false,
      viewer: null,
      connections: [],
      activeConnectionId: null
    }
  }
  let credentialError: string | undefined
  try {
    readKey(active.id)
  } catch (error) {
    if (!(error instanceof CredentialDecryptionError)) {
      throw error
    }
    credentialError = error.message
  }
  return {
    connected: credentialError === undefined,
    // The v1 API key surface exposes no viewer identity; the connection is
    // named by workspace instead, and members come from listWorkspaceMembers.
    viewer: null,
    connections: file.connections,
    activeConnectionId: file.activeConnectionId,
    selectedConnectionId: file.selectedConnectionId,
    ...(credentialError ? { credentialError } : {})
  }
}

export async function listConnectedProjects(signal?: AbortSignal): Promise<PlaneProject[]> {
  const client = getActiveClient()
  if (!client) {
    return []
  }
  return listProjects(client, signal)
}

export function planeConnectionDisplayName(baseUrl: string, workspaceSlug: string): string {
  return `${workspaceSlug} (${new URL(normalizeBaseUrl(baseUrl)).host})`
}

// The Tasks surface needs a project before it can read anything, so the choice
// is stored with the connection rather than held in renderer state that a
// reload would lose.
export function setDefaultPlaneProject(
  connectionId: string,
  projectId: string | null
): PlaneConnectionStatus {
  const file = getConnectionFile()
  writeConnectionFile({
    ...file,
    connections: file.connections.map((connection) =>
      connection.id === connectionId ? { ...connection, defaultProjectId: projectId } : connection
    )
  })
  return getPlaneStatus()
}
