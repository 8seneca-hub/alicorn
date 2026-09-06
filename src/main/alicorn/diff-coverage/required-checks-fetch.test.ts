import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRequiredChecks } from './required-checks-fetch'
import { alicornFetch } from '../control-plane-http'

vi.mock('../control-plane-http', () => ({ alicornFetch: vi.fn() }))

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response
}

beforeEach(() => {
  vi.mocked(alicornFetch).mockReset()
})

describe('fetchRequiredChecks', () => {
  it('gets the project required checks over the control service', async () => {
    const checks = [
      { kind: 'diff_coverage', threshold: 0.8, lcovPath: 'coverage/lcov.info', timeoutMs: 30_000 }
    ]
    vi.mocked(alicornFetch).mockResolvedValue(jsonResponse({ checks }))

    const result = await fetchRequiredChecks('proj_1')

    expect(alicornFetch).toHaveBeenCalledWith('control', '/v1/projects/proj_1/required-checks')
    expect(result).toEqual(checks)
  })

  it('percent-encodes a project id containing a colon and a slash', async () => {
    vi.mocked(alicornFetch).mockResolvedValue(jsonResponse({ checks: [] }))

    await fetchRequiredChecks('github:acme/repo')

    expect(alicornFetch).toHaveBeenCalledWith(
      'control',
      '/v1/projects/github%3Aacme%2Frepo/required-checks'
    )
  })

  it('throws a clear error when the response body has no checks array', async () => {
    vi.mocked(alicornFetch).mockResolvedValue(jsonResponse({ notChecks: true }))

    await expect(fetchRequiredChecks('proj_1')).rejects.toThrow(
      'required-checks response has no checks array'
    )
  })
})
