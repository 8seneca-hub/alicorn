// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  planeConnect,
  planeDisconnect,
  planeListIssues,
  planeListProjects,
  planeStatus
} from './runtime-plane-client'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'
import { createCompatibleRuntimeStatusResponse } from './runtime-compatibility-test-fixture'

const localStatus = vi.fn()
const localConnect = vi.fn()
const localDisconnect = vi.fn()
const localListProjects = vi.fn()
const localListIssues = vi.fn()
const runtimeCall = vi.fn()
const runtimeSubscribe = vi.fn()

const REMOTE = { activeRuntimeEnvironmentId: 'env-1' }
const LOCAL = { activeRuntimeEnvironmentId: null }

function rpcResult(result: unknown) {
  return { id: 'rpc-1', ok: true, result }
}

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  for (const mock of [
    localStatus,
    localConnect,
    localDisconnect,
    localListProjects,
    localListIssues,
    runtimeCall,
    runtimeSubscribe
  ]) {
    mock.mockReset()
  }
  runtimeCall.mockImplementation(async (args: { method: string }) =>
    args.method === 'status.get' ? createCompatibleRuntimeStatusResponse() : rpcResult(null)
  )
  vi.stubGlobal('window', {
    api: {
      plane: {
        status: localStatus,
        connect: localConnect,
        disconnect: localDisconnect,
        listProjects: localListProjects,
        listIssues: localListIssues
      },
      runtimeEnvironments: { call: runtimeCall, subscribe: runtimeSubscribe }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function rpcMethodsCalled(): string[] {
  return runtimeCall.mock.calls
    .map((call) => (call[0] as { method: string }).method)
    .filter((method) => method !== 'status.get')
}

describe('local host', () => {
  it('reads status over IPC and never touches the runtime', async () => {
    localStatus.mockResolvedValue({ connected: true, viewer: null })

    await expect(planeStatus(LOCAL)).resolves.toEqual({ connected: true, viewer: null })
    expect(runtimeCall).not.toHaveBeenCalled()
  })

  it('routes every read over IPC when no runtime environment is active', async () => {
    localListProjects.mockResolvedValue({ ok: true, value: [] })
    localListIssues.mockResolvedValue({ ok: true, value: [] })

    await planeListProjects(LOCAL)
    await planeListIssues(LOCAL, { projectId: 'p1' })

    expect(localListProjects).toHaveBeenCalledTimes(1)
    expect(localListIssues).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(runtimeCall).not.toHaveBeenCalled()
  })
})

describe('paired runtime host', () => {
  it('routes status to the host that owns the workspace', async () => {
    runtimeCall.mockImplementation(async (args: { method: string }) =>
      args.method === 'status.get'
        ? createCompatibleRuntimeStatusResponse()
        : rpcResult({ connected: true, viewer: null })
    )

    await expect(planeStatus(REMOTE)).resolves.toEqual({ connected: true, viewer: null })
    expect(rpcMethodsCalled()).toEqual(['plane.status'])
    expect(localStatus).not.toHaveBeenCalled()
  })

  it('sends the connect payload to the host so the key is stored there', async () => {
    runtimeCall.mockImplementation(async (args: { method: string }) =>
      args.method === 'status.get'
        ? createCompatibleRuntimeStatusResponse()
        : rpcResult({ ok: true, value: { connected: true, viewer: null } })
    )
    const args = { baseUrl: 'https://p.example.com', workspaceSlug: 'ws', apiKey: 'secret' }

    await planeConnect(REMOTE, args)

    const connectCall = runtimeCall.mock.calls.find(
      (call) => (call[0] as { method: string }).method === 'plane.connect'
    )
    expect(connectCall).toBeDefined()
    expect((connectCall![0] as { params: unknown }).params).toEqual(args)
    expect(localConnect).not.toHaveBeenCalled()
  })

  it('routes reads and disconnect to the host too', async () => {
    await planeListIssues(REMOTE, { projectId: 'p1', projectIdentifier: 'ALC' })
    await planeDisconnect(REMOTE, { connectionId: 'c1' })

    expect(rpcMethodsCalled()).toEqual(['plane.listIssues', 'plane.disconnect'])
    expect(localListIssues).not.toHaveBeenCalled()
    expect(localDisconnect).not.toHaveBeenCalled()
  })

  it('follows the task source host rather than the active environment', async () => {
    localStatus.mockResolvedValue({ connected: false, viewer: null })

    // A task source read from the local host stays local even while a runtime
    // environment is active, so a list cannot resolve against another machine.
    await planeStatus({
      kind: 'task-source',
      provider: 'plane',
      projectId: 'p1',
      hostId: 'local'
    })

    expect(localStatus).toHaveBeenCalledTimes(1)
    expect(runtimeCall).not.toHaveBeenCalled()
  })
})
