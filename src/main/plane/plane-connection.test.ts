import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeOs from 'node:os'

const fetchMock = vi.fn()
let homeDir = ''

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOs>()
  return { ...actual, homedir: () => homeDir }
})
vi.mock('../network/http-client', () => ({
  getMainHttpClient: () => ({ fetch: fetchMock, proxySession: () => null })
}))
vi.mock('../network/proxy-settings', () => ({ ensureElectronProxyFromEnvironment: async () => {} }))
vi.mock('../observability/tracer', () => ({
  withSpan: async (_name: string, run: (span: unknown) => unknown) =>
    run({ setAttribute: () => {}, addEvent: () => {} })
}))
vi.mock('../../shared/secret-store', () => ({
  getSecretStore: () => ({ isEncryptionAvailable: () => false })
}))

import { connectPlane, disconnectPlane, getActiveClient, getPlaneStatus } from './plane-connection'
import { connectionIdFor, resetPlaneConnectionCacheForTests } from './plane-connection-store'
import { PlaneApiError } from './plane-request'

function projectsResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ results: [{ id: 'p1', name: 'Alicorn', identifier: 'ALC' }] })
  } as unknown as Response
}

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'plane-connection-'))
  fetchMock.mockReset()
  resetPlaneConnectionCacheForTests()
})

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true })
})

describe('connectPlane', () => {
  it('probes the workspace, saves the connection and reports connected', async () => {
    fetchMock.mockResolvedValueOnce(projectsResponse())

    const status = await connectPlane({
      baseUrl: 'https://plane.example.com/',
      workspaceSlug: '8seneca',
      apiKey: 'secret-key'
    })

    expect(status.connected).toBe(true)
    expect(status.connections).toEqual([
      {
        id: '8seneca@https://plane.example.com',
        baseUrl: 'https://plane.example.com',
        workspaceSlug: '8seneca',
        displayName: '8seneca (plane.example.com)'
      }
    ])
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://plane.example.com/api/v1/workspaces/8seneca/projects/')
    expect(new Headers((init as RequestInit).headers).get('X-API-Key')).toBe('secret-key')
  })

  it('refuses plain HTTP to a non-loopback host so the key stays off the wire', async () => {
    await expect(
      connectPlane({ baseUrl: 'http://plane.example.com', workspaceSlug: 'ws', apiKey: 'k' })
    ).rejects.toBeInstanceOf(PlaneApiError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows loopback HTTP for a local deployment', async () => {
    fetchMock.mockResolvedValueOnce(projectsResponse())
    await expect(
      connectPlane({ baseUrl: 'http://localhost:8000', workspaceSlug: 'ws', apiKey: 'k' })
    ).resolves.toMatchObject({ connected: true })
  })

  it('rejects a blank workspace or key before touching the network', async () => {
    await expect(
      connectPlane({ baseUrl: 'https://plane.example.com', workspaceSlug: '  ', apiKey: 'k' })
    ).rejects.toBeInstanceOf(PlaneApiError)
    await expect(
      connectPlane({ baseUrl: 'https://plane.example.com', workspaceSlug: 'ws', apiKey: '  ' })
    ).rejects.toBeInstanceOf(PlaneApiError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a response that is not a workspace project list', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ detail: 'Not found.' })
    } as unknown as Response)

    await expect(
      connectPlane({ baseUrl: 'https://plane.example.com', workspaceSlug: 'nope', apiKey: 'k' })
    ).rejects.toThrow(/nope/)
  })

  it('surfaces the API error message on a rejected key', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'Invalid API key.' })
    } as unknown as Response)

    await expect(
      connectPlane({ baseUrl: 'https://plane.example.com', workspaceSlug: 'ws', apiKey: 'bad' })
    ).rejects.toThrow('Invalid API key.')
  })

  it('replaces rather than duplicates a reconnect of the same workspace', async () => {
    fetchMock.mockResolvedValue(projectsResponse())

    await connectPlane({ baseUrl: 'https://plane.example.com', workspaceSlug: 'ws', apiKey: 'k1' })
    const status = await connectPlane({
      baseUrl: 'https://plane.example.com',
      workspaceSlug: 'ws',
      apiKey: 'k2'
    })

    expect(status.connections).toHaveLength(1)
    expect(getActiveClient()?.apiKey).toBe('k2')
  })

  it('keeps two workspaces on the same deployment apart', async () => {
    fetchMock.mockResolvedValue(projectsResponse())

    await connectPlane({ baseUrl: 'https://plane.example.com', workspaceSlug: 'a', apiKey: 'ka' })
    const status = await connectPlane({
      baseUrl: 'https://plane.example.com',
      workspaceSlug: 'b',
      apiKey: 'kb'
    })

    expect(status.connections).toHaveLength(2)
    expect(status.activeConnectionId).toBe(connectionIdFor('https://plane.example.com', 'b'))
  })
})

describe('getPlaneStatus', () => {
  it('reports disconnected with no saved connection', () => {
    expect(getPlaneStatus()).toEqual({
      connected: false,
      viewer: null,
      connections: [],
      activeConnectionId: null
    })
  })
})

describe('disconnectPlane', () => {
  it('removes the connection and its key', async () => {
    fetchMock.mockResolvedValue(projectsResponse())
    await connectPlane({ baseUrl: 'https://plane.example.com', workspaceSlug: 'ws', apiKey: 'k' })

    const status = disconnectPlane()

    expect(status.connected).toBe(false)
    expect(status.connections).toEqual([])
    expect(getActiveClient()).toBeNull()
  })

  it('leaves other connections alone when given one id', async () => {
    fetchMock.mockResolvedValue(projectsResponse())
    await connectPlane({ baseUrl: 'https://plane.example.com', workspaceSlug: 'a', apiKey: 'ka' })
    await connectPlane({ baseUrl: 'https://plane.example.com', workspaceSlug: 'b', apiKey: 'kb' })

    const status = disconnectPlane(connectionIdFor('https://plane.example.com', 'a'))

    expect(status.connections?.map((connection) => connection.workspaceSlug)).toEqual(['b'])
  })
})
