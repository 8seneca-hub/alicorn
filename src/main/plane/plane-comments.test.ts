import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addIssueComment, markdownToHtmlParagraphs } from './plane-comments'
import { resetPlaneIssueEndpointCacheForTests } from './plane-issue-endpoint'
import type { PlaneClient } from './plane-request'

const fetchMock = vi.fn()

vi.mock('../network/http-client', () => ({
  getMainHttpClient: () => ({
    fetch: (...args: unknown[]) => fetchMock(...args),
    proxySession: () => null
  })
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

beforeEach(() => {
  fetchMock.mockReset()
  resetPlaneIssueEndpointCacheForTests()
})

describe('markdownToHtmlParagraphs', () => {
  it('splits blank-line-separated blocks into paragraphs', () => {
    expect(markdownToHtmlParagraphs('one\n\ntwo')).toBe('<p>one</p><p>two</p>')
  })

  it('keeps a single newline as a line break inside one paragraph', () => {
    expect(markdownToHtmlParagraphs('one\ntwo')).toBe('<p>one<br>two</p>')
  })

  // Why: a comment body is user text going into an HTML field — unescaped it
  // would inject markup into someone else's board.
  it('escapes markup rather than letting it through', () => {
    expect(markdownToHtmlParagraphs('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
    )
  })

  it('escapes ampersands so an entity is not double-decoded', () => {
    expect(markdownToHtmlParagraphs('a & b')).toBe('<p>a &amp; b</p>')
  })

  it('produces an empty paragraph rather than an empty body', () => {
    expect(markdownToHtmlParagraphs('   \n\n  ')).toBe('<p></p>')
  })
})

describe('addIssueComment', () => {
  it('POSTs the comment to the issue and maps the reply', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'c1',
        comment_html: '<p>looks good</p>',
        actor: 'user-1',
        created_at: '2026-09-07T00:00:00Z',
        updated_at: '2026-09-07T00:00:00Z'
      })
    } as unknown as Response)

    const comment = await addIssueComment(client, 'project-1', 'issue-1', 'looks good')

    expect(comment).toMatchObject({ id: 'c1', actorId: 'user-1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://projects.example.com/api/v1/workspaces/8seneca/projects/project-1/work-items/issue-1/comments/'
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ comment_html: '<p>looks good</p>' })
  })

  it('falls back to the legacy issues path on an older deployment', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ detail: 'Not found.' })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'c1', created_at: '2026-09-07T00:00:00Z' })
      } as unknown as Response)

    await addIssueComment(client, 'project-1', 'issue-1', 'hi')

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://projects.example.com/api/v1/workspaces/8seneca/projects/project-1/work-items/issue-1/comments/',
      'https://projects.example.com/api/v1/workspaces/8seneca/projects/project-1/issues/issue-1/comments/'
    ])
  })

  it('surfaces a rejected comment as an error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ comment_html: ['This field may not be blank.'] })
    } as unknown as Response)

    await expect(addIssueComment(client, 'project-1', 'issue-1', 'x')).rejects.toThrow(
      'comment_html: This field may not be blank.'
    )
  })
})
