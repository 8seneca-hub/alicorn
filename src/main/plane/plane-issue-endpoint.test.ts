import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetPlaneIssueEndpointCacheForTests, withIssueSegment } from './plane-issue-endpoint'
import { PlaneApiError, type PlaneClient } from './plane-request'

vi.mock('../network/http-client', () => ({ getMainHttpClient: () => ({}) }))
vi.mock('../network/proxy-settings', () => ({ ensureElectronProxyFromEnvironment: async () => {} }))
vi.mock('../observability/tracer', () => ({
  withSpan: async (_name: string, run: (span: unknown) => unknown) =>
    run({ setAttribute: () => {}, addEvent: () => {} })
}))

function clientFor(id: string): PlaneClient {
  return { connectionId: id, baseUrl: 'https://p.example.com', workspaceSlug: 'ws', apiKey: 'k' }
}

beforeEach(() => {
  resetPlaneIssueEndpointCacheForTests()
})

describe('withIssueSegment', () => {
  it('uses the current work-items path when the deployment supports it', async () => {
    const run = vi.fn().mockResolvedValue('ok')

    await expect(withIssueSegment(clientFor('a'), run)).resolves.toBe('ok')

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('work-items')
  })

  it('falls back to the legacy path on a 404', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new PlaneApiError('Not found.', 404))
      .mockResolvedValueOnce('legacy')

    await expect(withIssueSegment(clientFor('a'), run)).resolves.toBe('legacy')

    expect(run.mock.calls.map((call) => call[0])).toEqual(['work-items', 'issues'])
  })

  it('remembers the fallback so an old deployment is probed once', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new PlaneApiError('Not found.', 404))
      .mockResolvedValue('legacy')
    const client = clientFor('a')

    await withIssueSegment(client, run)
    run.mockClear()
    await withIssueSegment(client, run)

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('issues')
  })

  it('keeps the answer per connection — two deployments can differ in version', async () => {
    const oldRun = vi
      .fn()
      .mockRejectedValueOnce(new PlaneApiError('Not found.', 404))
      .mockResolvedValue('legacy')
    await withIssueSegment(clientFor('old'), oldRun)

    const newRun = vi.fn().mockResolvedValue('current')
    await withIssueSegment(clientFor('new'), newRun)

    expect(newRun).toHaveBeenCalledTimes(1)
    expect(newRun).toHaveBeenCalledWith('work-items')
  })

  it('propagates a non-404 failure instead of retrying the legacy path', async () => {
    const run = vi.fn().mockRejectedValue(new PlaneApiError('Invalid API key.', 401))

    await expect(withIssueSegment(clientFor('a'), run)).rejects.toThrow('Invalid API key.')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('still surfaces a 404 when neither path resolves', async () => {
    const run = vi.fn().mockRejectedValue(new PlaneApiError('Not found.', 404))

    await expect(withIssueSegment(clientFor('a'), run)).rejects.toThrow('Not found.')
    expect(run.mock.calls.map((call) => call[0])).toEqual(['work-items', 'issues'])
  })
})
