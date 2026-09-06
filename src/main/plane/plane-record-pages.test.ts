import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAllPages, withQuery } from './plane-record-pages'
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
  apiKey: 'secret-key'
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('withQuery', () => {
  it('omits empty and undefined parameters', () => {
    expect(withQuery('/p', { a: '1', b: undefined, c: '' })).toBe('/p?a=1')
  })

  it('returns the bare path when nothing is set', () => {
    expect(withQuery('/p', { a: undefined })).toBe('/p')
  })
})

describe('fetchAllPages', () => {
  it('follows next_cursor and concatenates results', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ id: 'a' }], next_cursor: 'c2', next_page_results: true })
      )
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ id: 'b' }], next_cursor: 'c3', next_page_results: false })
      )

    await expect(fetchAllPages(client, '/api/v1/x/')).resolves.toEqual([{ id: 'a' }, { id: 'b' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toContain('cursor=c2')
  })

  it('stops on the last page even though it still carries a cursor', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ results: [{ id: 'a' }], next_cursor: 'c2', next_page_results: false })
    )

    await expect(fetchAllPages(client, '/api/v1/x/')).resolves.toEqual([{ id: 'a' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends the API key as a header and never in the URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_page_results: false }))

    await fetchAllPages(client, '/api/v1/x/')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).not.toContain('secret-key')
    expect(new Headers((init as RequestInit).headers).get('X-API-Key')).toBe('secret-key')
  })

  it('clamps per_page to the server maximum', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], next_page_results: false }))

    await fetchAllPages(client, '/api/v1/x/', { perPage: 5000 })

    expect(fetchMock.mock.calls[0]?.[0]).toContain('per_page=100')
  })

  it('tolerates a page with no results array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ next_page_results: false }))
    await expect(fetchAllPages(client, '/api/v1/x/')).resolves.toEqual([])
  })

  it('gives up rather than paginating forever', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ id: 'a' }], next_cursor: 'same', next_page_results: true })
    )

    const all = await fetchAllPages(client, '/api/v1/x/')

    expect(all).toHaveLength(50)
    expect(fetchMock).toHaveBeenCalledTimes(50)
  })
})
