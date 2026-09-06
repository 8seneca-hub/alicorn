import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

const connectPlane = vi.fn()
const disconnectPlane = vi.fn()
const getActiveClient = vi.fn()
const getClientById = vi.fn()
const getPlaneStatus = vi.fn()
const listProjects = vi.fn()
const listProjectStates = vi.fn()
const listWorkspaceMembers = vi.fn()
const listProjectIssues = vi.fn()
const getProjectIssue = vi.fn()

vi.mock('../plane/plane-connection', () => ({
  connectPlane: (...args: unknown[]) => connectPlane(...args),
  disconnectPlane: (...args: unknown[]) => disconnectPlane(...args),
  getActiveClient: () => getActiveClient(),
  getClientById: (...args: unknown[]) => getClientById(...args),
  getPlaneStatus: () => getPlaneStatus()
}))
vi.mock('../plane/plane-project-queries', () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
  listProjectStates: (...args: unknown[]) => listProjectStates(...args),
  listWorkspaceMembers: (...args: unknown[]) => listWorkspaceMembers(...args)
}))
vi.mock('../plane/plane-issue-queries', () => ({
  listProjectIssues: (...args: unknown[]) => listProjectIssues(...args),
  getProjectIssue: (...args: unknown[]) => getProjectIssue(...args)
}))

import { registerPlaneHandlers } from './plane'

const CLIENT = { connectionId: 'ws@https://p.example.com' }

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler({}, args)
}

beforeEach(() => {
  handlers.clear()
  for (const mock of [
    connectPlane,
    disconnectPlane,
    getActiveClient,
    getClientById,
    getPlaneStatus,
    listProjects,
    listProjectStates,
    listWorkspaceMembers,
    listProjectIssues,
    getProjectIssue
  ]) {
    mock.mockReset()
  }
  getActiveClient.mockReturnValue(CLIENT)
  registerPlaneHandlers()
})

describe('plane:connect', () => {
  it('rejects a payload missing any of the three fields', async () => {
    for (const args of [
      {},
      { baseUrl: 'https://p.example.com' },
      { baseUrl: 'https://p.example.com', workspaceSlug: 'ws' },
      { baseUrl: 'https://p.example.com', workspaceSlug: 'ws', apiKey: '   ' }
    ]) {
      await expect(invoke('plane:connect', args)).resolves.toEqual({
        ok: false,
        error: 'Plane URL, workspace slug, and API key are required.'
      })
    }
    expect(connectPlane).not.toHaveBeenCalled()
  })

  it('trims the payload before connecting', async () => {
    connectPlane.mockResolvedValue({ connected: true })

    await expect(
      invoke('plane:connect', {
        baseUrl: '  https://p.example.com  ',
        workspaceSlug: ' ws ',
        apiKey: ' k '
      })
    ).resolves.toEqual({ ok: true, value: { connected: true } })
    expect(connectPlane).toHaveBeenCalledWith({
      baseUrl: 'https://p.example.com',
      workspaceSlug: 'ws',
      apiKey: 'k'
    })
  })

  it('returns a rejected connect as an error rather than throwing across IPC', async () => {
    connectPlane.mockRejectedValue(new Error('Invalid API key.'))

    await expect(
      invoke('plane:connect', {
        baseUrl: 'https://p.example.com',
        workspaceSlug: 'ws',
        apiKey: 'bad'
      })
    ).resolves.toEqual({ ok: false, error: 'Invalid API key.' })
  })
})

describe('reads', () => {
  it('reports no connection instead of throwing', async () => {
    getActiveClient.mockReturnValue(null)

    await expect(invoke('plane:listProjects')).resolves.toEqual({
      ok: false,
      error: 'No Plane workspace is connected.'
    })
    expect(listProjects).not.toHaveBeenCalled()
  })

  it('resolves an explicit connection id rather than the active one', async () => {
    getClientById.mockReturnValue({ connectionId: 'other' })
    listProjects.mockResolvedValue([])

    await invoke('plane:listProjects', { connectionId: 'other' })

    expect(getClientById).toHaveBeenCalledWith('other')
    expect(getActiveClient).not.toHaveBeenCalled()
    expect(listProjects).toHaveBeenCalledWith({ connectionId: 'other' })
  })

  it('requires a project id for states, issues and detail', async () => {
    await expect(invoke('plane:listStates', {})).resolves.toEqual({
      ok: false,
      error: 'A Plane project id is required.'
    })
    await expect(invoke('plane:listIssues', {})).resolves.toEqual({
      ok: false,
      error: 'A Plane project id is required.'
    })
    await expect(invoke('plane:getIssue', { projectId: 'p' })).resolves.toEqual({
      ok: false,
      error: 'A Plane project id and issue id are required.'
    })
  })

  it('passes the project identifier and ordering through to the issue read', async () => {
    listProjectIssues.mockResolvedValue([])

    await invoke('plane:listIssues', {
      projectId: 'p1',
      projectIdentifier: 'ALC',
      orderBy: '-updated_at'
    })

    expect(listProjectIssues).toHaveBeenCalledWith(CLIENT, 'p1', {
      projectIdentifier: 'ALC',
      orderBy: '-updated_at'
    })
  })

  it('omits optional read options that were not supplied', async () => {
    listProjectIssues.mockResolvedValue([])

    await invoke('plane:listIssues', { projectId: 'p1' })

    expect(listProjectIssues).toHaveBeenCalledWith(CLIENT, 'p1', {})
  })

  it('surfaces a read failure as an error result', async () => {
    listWorkspaceMembers.mockRejectedValue(new Error('403'))

    await expect(invoke('plane:listMembers')).resolves.toEqual({ ok: false, error: '403' })
  })

  it('returns status without an ok envelope', async () => {
    getPlaneStatus.mockReturnValue({ connected: false, viewer: null })

    await expect(invoke('plane:status')).resolves.toEqual({ connected: false, viewer: null })
  })
})
