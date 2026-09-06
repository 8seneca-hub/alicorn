import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CredentialDecryptionError,
  credentialFileHasContent,
  readStoredCredentialToken,
  writeEncryptedCredential
} from '../integration-credential-file'
import type { PlaneConnection, PlaneConnectionSelection } from '../../shared/plane-types'

export type PlaneConnectionFile = {
  version: 1
  activeConnectionId: string | null
  selectedConnectionId: PlaneConnectionSelection | null
  connections: PlaneConnection[]
}

let cachedFile: PlaneConnectionFile | null = null
let fileLoaded = false
const cachedKeys = new Map<string, string>()
// Why: decrypt failures are recorded per connection so getStatus can explain
// failing reads without re-touching the keychain on every status poll.
export const credentialErrors = new Map<string, string>()

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getConnectionFilePath(): string {
  return join(getOrcaDir(), 'plane-connections.json')
}

function getKeyDir(): string {
  return join(getOrcaDir(), 'plane-keys')
}

function getKeyPath(connectionId: string): string {
  return join(getKeyDir(), `${Buffer.from(connectionId).toString('base64url')}.enc`)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function emptyFile(): PlaneConnectionFile {
  return {
    version: 1,
    activeConnectionId: null,
    selectedConnectionId: null,
    connections: []
  }
}

// A Plane API key is scoped to one workspace of one deployment, so that pair
// is the connection identity — reconnecting the same workspace replaces it
// rather than accumulating duplicates.
export function connectionIdFor(baseUrl: string, workspaceSlug: string): string {
  return `${workspaceSlug}@${normalizeBaseUrl(baseUrl)}`
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function hasStoredKey(connectionId: string): boolean {
  return cachedKeys.has(connectionId) || credentialFileHasContent(getKeyPath(connectionId))
}

function normalizeConnection(input: unknown): PlaneConnection | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    typeof record.baseUrl !== 'string' ||
    typeof record.workspaceSlug !== 'string' ||
    typeof record.displayName !== 'string'
  ) {
    return null
  }
  return {
    id: record.id,
    baseUrl: normalizeBaseUrl(record.baseUrl),
    workspaceSlug: record.workspaceSlug,
    displayName: record.displayName,
    defaultProjectId: typeof record.defaultProjectId === 'string' ? record.defaultProjectId : null
  }
}

function readFileFromDisk(): PlaneConnectionFile {
  const path = getConnectionFilePath()
  if (!existsSync(path)) {
    return emptyFile()
  }
  try {
    const parsed = JSON.parse(
      readFileSync(path, { encoding: 'utf-8' })
    ) as Partial<PlaneConnectionFile>
    // A connection with no key cannot authenticate, so it is not a connection.
    const connections = Array.isArray(parsed.connections)
      ? parsed.connections
          .map((connection) => normalizeConnection(connection))
          .filter((connection): connection is PlaneConnection => connection !== null)
          .filter((connection) => hasStoredKey(connection.id))
      : []
    return withResolvedSelection(
      connections,
      parsed.activeConnectionId,
      parsed.selectedConnectionId
    )
  } catch {
    return emptyFile()
  }
}

function withResolvedSelection(
  connections: PlaneConnection[],
  activeCandidate: unknown,
  selectedCandidate: unknown
): PlaneConnectionFile {
  const activeConnectionId =
    typeof activeCandidate === 'string' &&
    connections.some((connection) => connection.id === activeCandidate)
      ? activeCandidate
      : (connections[0]?.id ?? null)
  const selectedConnectionId =
    selectedCandidate === 'all' ||
    (typeof selectedCandidate === 'string' &&
      connections.some((connection) => connection.id === selectedCandidate))
      ? (selectedCandidate as PlaneConnectionSelection)
      : activeConnectionId
  return { version: 1, activeConnectionId, selectedConnectionId, connections }
}

export function getConnectionFile(): PlaneConnectionFile {
  if (!fileLoaded || !cachedFile) {
    cachedFile = readFileFromDisk()
    fileLoaded = true
  }
  return cachedFile
}

export function writeConnectionFile(file: PlaneConnectionFile): void {
  ensureDir(getOrcaDir())
  const connections = file.connections.filter((connection) => hasStoredKey(connection.id))
  cachedFile = withResolvedSelection(
    connections,
    file.activeConnectionId,
    file.selectedConnectionId
  )
  fileLoaded = true
  writeFileSync(getConnectionFilePath(), JSON.stringify(cachedFile, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
}

export function readKey(connectionId: string): string | null {
  const cached = cachedKeys.get(connectionId)
  if (cached !== undefined) {
    return cached
  }
  const path = getKeyPath(connectionId)
  if (!existsSync(path)) {
    return null
  }
  try {
    const key = readStoredCredentialToken('Plane', readFileSync(path))
    if (key) {
      cachedKeys.set(connectionId, key)
    }
    credentialErrors.delete(connectionId)
    return key
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      credentialErrors.set(connectionId, error.message)
      throw error
    }
    return null
  }
}

export function saveKey(connectionId: string, apiKey: string): void {
  ensureDir(getOrcaDir())
  ensureDir(getKeyDir())
  writeEncryptedCredential('Plane', getKeyPath(connectionId), apiKey)
  cachedKeys.set(connectionId, apiKey)
  credentialErrors.delete(connectionId)
}

export function deleteKey(connectionId: string): void {
  cachedKeys.delete(connectionId)
  credentialErrors.delete(connectionId)
  try {
    unlinkSync(getKeyPath(connectionId))
  } catch {
    // Key may not exist — safe to ignore.
  }
}

// Test seam: the module caches the connection file and decrypted keys for the
// life of the process, which would leak state between test cases.
export function resetPlaneConnectionCacheForTests(): void {
  cachedFile = null
  fileLoaded = false
  cachedKeys.clear()
  credentialErrors.clear()
}
