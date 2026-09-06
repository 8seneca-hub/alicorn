import { afterEach, describe, expect, it, vi } from 'vitest'
import { updateIssueState } from './plane-issue-mutations'
import { resetPlaneIssueEndpointCacheForTests } from './plane-issue-endpoint'
import type { PlaneClient } from './plane-request'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('../network/http-client', () => ({
  getMainHttpClient: () => ({ fetch: fetchMock, proxySession: () => null })
}))
vi.mock('../network/proxy-settings', () => ({ ensureElectronProxyFromEnvironment: async () => {} }))
vi.mock('../observability/tracer', () => ({
  withSpan: async (_name: string, run: (span: unknown) => unknown) =>
    run({ setAttribute: () => {}, addEvent: () => {} })
}))

const client: PlaneClient = {
  connectionId: '8seneca@https://projects.example.com',
  baseUrl: 'https://projects.example.com',
  workspaceSlug: '8seneca',
  apiKey: 'key'
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('updateIssueState', () => {
  afterEach(() => {
    fetchMock.mockReset()
    resetPlaneIssueEndpointCacheForTests()
  })

  it('PATCHes the state onto the work-item route and returns the updated issue', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'issue-1',
        name: 'B1',
        project: 'project-1',
        state: 'state-2',
        sequence_id: 11
      })
    )

    const issue = await updateIssueState(client, 'project-1', 'issue-1', 'state-2')

    expect(issue?.stateId).toBe('state-2')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      'https://projects.example.com/api/v1/workspaces/8seneca/projects/project-1/work-items/issue-1/'
    )
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ state: 'state-2' })
  })

  // Why: Plane v1.0.0 and older only answer /issues/. PP1's probe cache owns that fallback, and a
  // write must go through it too or it 404s on older deployments.
  it('falls back to the legacy issues route on 404', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'Not found.' }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'issue-1',
          name: 'B1',
          project: 'project-1',
          state: 'state-2',
          sequence_id: 11
        })
      )

    const issue = await updateIssueState(client, 'project-1', 'issue-1', 'state-2')

    expect(issue?.stateId).toBe('state-2')
    expect(fetchMock.mock.calls[1]![0]).toContain('/issues/issue-1/')
  })

  it('surfaces a rejected write rather than reporting success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ state: ['This field is required.'] }, 400))

    await expect(updateIssueState(client, 'project-1', 'issue-1', 'state-2')).rejects.toThrow(
      /state: This field is required/
    )
  })

  it('percent-encodes ids so a slashed id cannot escape the path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'a/b', name: 'B1', project: 'p/1', state: 's', sequence_id: 1 })
    )

    await updateIssueState(client, 'p/1', 'a/b', 's')

    expect(fetchMock.mock.calls[0]![0]).toContain('/projects/p%2F1/work-items/a%2Fb/')
  })
})
