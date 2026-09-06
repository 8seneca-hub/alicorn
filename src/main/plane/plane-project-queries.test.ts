import { describe, expect, it, vi } from 'vitest'
import {
  listWorkspaceMembers,
  mapPlaneMember,
  mapPlaneProject,
  mapPlaneState
} from './plane-project-queries'
import type { PlaneClient } from './plane-request'

const fetchMock = vi.fn()
vi.mock('../network/http-client', () => ({
  getMainHttpClient: () => ({ fetch: fetchMock, proxySession: () => null })
}))
vi.mock('../network/proxy-settings', () => ({ ensureElectronProxyFromEnvironment: async () => {} }))
vi.mock('../observability/tracer', () => ({
  withSpan: async (_name: string, run: (span: unknown) => unknown) =>
    run({ setAttribute: () => {}, addEvent: () => {} })
}))

const client: PlaneClient = {
  connectionId: 'ws@https://plane.example.com',
  baseUrl: 'https://plane.example.com',
  workspaceSlug: 'ws',
  apiKey: 'key'
}

describe('mapPlaneProject', () => {
  it('carries the identifier used to build readable issue ids', () => {
    expect(mapPlaneProject({ id: 'p1', name: 'Alicorn', identifier: 'ALC' }, client)).toEqual({
      id: 'p1',
      identifier: 'ALC',
      name: 'Alicorn',
      connectionId: client.connectionId,
      workspaceSlug: 'ws'
    })
  })

  it('drops a project with no id or name', () => {
    expect(mapPlaneProject({ name: 'no id' }, client)).toBeNull()
    expect(mapPlaneProject({ id: 'p1' }, client)).toBeNull()
  })
})

describe('mapPlaneState', () => {
  it('maps a state and its group', () => {
    expect(
      mapPlaneState({ id: 's1', name: 'In Progress', color: '#F59E0B', group: 'started' })
    ).toEqual({
      id: 's1',
      name: 'In Progress',
      color: '#F59E0B',
      group: 'started',
      isDefault: false
    })
  })

  it('keeps an unrecognised group selectable rather than dropping the state', () => {
    expect(mapPlaneState({ id: 's1', name: 'Triage', group: 'invented' })?.group).toBe('backlog')
  })

  it('reads the default flag from Plane’s reserved word field', () => {
    expect(mapPlaneState({ id: 's1', name: 'Backlog', default: true })?.isDefault).toBe(true)
  })
})

describe('mapPlaneMember', () => {
  it('prefers the full name', () => {
    expect(
      mapPlaneMember({ id: 'u1', first_name: 'Nghia', last_name: 'Dang', email: 'n@example.com' })
    ).toEqual({ id: 'u1', displayName: 'Nghia Dang', email: 'n@example.com' })
  })

  it('falls back to display_name then email for half-onboarded members', () => {
    expect(
      mapPlaneMember({ id: 'u1', first_name: '', last_name: '', display_name: 'toan.duc' })
        ?.displayName
    ).toBe('toan.duc')
    expect(mapPlaneMember({ id: 'u1', email: 'x@example.com' })?.displayName).toBe('x@example.com')
    expect(mapPlaneMember({ id: 'u1' })?.displayName).toBe('u1')
  })

  it('reports a missing email as null rather than an empty string', () => {
    expect(mapPlaneMember({ id: 'u1' })?.email).toBeNull()
  })
})

describe('listWorkspaceMembers', () => {
  function jsonResponse(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  }

  it('reads the bare array Plane returns for members', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 'u1', first_name: 'Nghia', last_name: 'Dang', email: 'n@example.com' },
        { id: 'u2', display_name: 'toan.duc' }
      ])
    )

    await expect(listWorkspaceMembers(client)).resolves.toEqual([
      { id: 'u1', displayName: 'Nghia Dang', email: 'n@example.com' },
      { id: 'u2', displayName: 'toan.duc', email: null }
    ])
    // One request: members is not paginated, so it must not go through the
    // cursor loop that every other list endpoint uses.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still reads an enveloped roster if a deployment returns one', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ id: 'u1', email: 'a@b.c' }] }))

    await expect(listWorkspaceMembers(client)).resolves.toEqual([
      { id: 'u1', displayName: 'a@b.c', email: 'a@b.c' }
    ])
  })

  it('returns an empty roster rather than throwing on an unexpected shape', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Not found.' }))

    await expect(listWorkspaceMembers(client)).resolves.toEqual([])
  })
})
