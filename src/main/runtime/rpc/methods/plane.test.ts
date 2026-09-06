import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { PLANE_METHODS } from './plane'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeRuntime() {
  return {
    getRuntimeId: () => 'test-runtime',
    planeStatus: vi.fn().mockReturnValue({ connected: true, viewer: null }),
    planeConnect: vi.fn().mockResolvedValue({ ok: true, value: { connected: true } }),
    planeDisconnect: vi.fn().mockReturnValue({ connected: false, viewer: null }),
    planeListProjects: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    planeListStates: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    planeListMembers: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    planeListIssues: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    planeGetIssue: vi.fn().mockResolvedValue({ ok: true, value: null })
  } as unknown as OrcaRuntimeService
}

describe('plane RPC methods', () => {
  it('routes every plane method to the runtime service', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(makeRequest('plane.status'))
    await dispatcher.dispatch(
      makeRequest('plane.connect', {
        baseUrl: '  https://p.example.com  ',
        workspaceSlug: ' ws ',
        apiKey: ' key '
      })
    )
    await dispatcher.dispatch(makeRequest('plane.listProjects'))
    await dispatcher.dispatch(makeRequest('plane.listStates', { projectId: 'p1' }))
    await dispatcher.dispatch(makeRequest('plane.listMembers'))
    await dispatcher.dispatch(makeRequest('plane.listIssues', { projectId: 'p1' }))
    await dispatcher.dispatch(makeRequest('plane.getIssue', { projectId: 'p1', issueId: 'i1' }))
    await dispatcher.dispatch(makeRequest('plane.disconnect', { connectionId: 'c1' }))

    expect(runtime.planeStatus).toHaveBeenCalled()
    // Trimmed at the boundary so a pasted key with whitespace still connects.
    expect(runtime.planeConnect).toHaveBeenCalledWith({
      baseUrl: 'https://p.example.com',
      workspaceSlug: 'ws',
      apiKey: 'key'
    })
    expect(runtime.planeListStates).toHaveBeenCalledWith('p1', undefined)
    expect(runtime.planeListIssues).toHaveBeenCalledWith('p1', {})
    expect(runtime.planeGetIssue).toHaveBeenCalledWith('p1', 'i1', {})
    expect(runtime.planeDisconnect).toHaveBeenCalledWith('c1')
  })

  it('passes optional read options through only when supplied', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(
      makeRequest('plane.listIssues', {
        projectId: 'p1',
        projectIdentifier: 'ALC',
        orderBy: '-updated_at',
        connectionId: 'c1'
      })
    )

    expect(runtime.planeListIssues).toHaveBeenCalledWith('p1', {
      projectIdentifier: 'ALC',
      orderBy: '-updated_at',
      connectionId: 'c1'
    })
  })

  it('rejects a connect that is missing a required field', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('plane.connect', { baseUrl: 'https://p.example.com', workspaceSlug: 'ws' })
    )

    expect(response.ok).toBe(false)
    expect(runtime.planeConnect).not.toHaveBeenCalled()
  })

  it('rejects a read that is missing its project id', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(makeRequest('plane.listIssues', {}))

    expect(response.ok).toBe(false)
    expect(runtime.planeListIssues).not.toHaveBeenCalled()
  })

  it('answers an unregistered method with method_not_found rather than silence', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(makeRequest('plane.notARealMethod'))

    expect(response.ok).toBe(false)
    expect(JSON.stringify(response)).toContain('method_not_found')
  })
})
