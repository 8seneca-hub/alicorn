import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  alicornFetch,
  ControlPlaneRequestError,
  ControlPlaneUnavailableError
} from './control-plane-http'

const TOKEN = 'local-dev-token-0123456789'
const fetchMock = vi.fn()
let savedEnv: NodeJS.ProcessEnv

function configure(env: NodeJS.ProcessEnv): void {
  process.env.ALICORN_CONTROL_API_URL = env.ALICORN_CONTROL_API_URL ?? ''
  process.env.ALICORN_LEDGER_API_URL = env.ALICORN_LEDGER_API_URL ?? ''
  process.env.ALICORN_LOCAL_API_TOKEN = env.ALICORN_LOCAL_API_TOKEN ?? ''
  process.env.ALICORN_TENANT_ID = env.ALICORN_TENANT_ID ?? ''
}

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
}

function errorResponse(status: number, body: unknown, statusText = ''): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => body
  } as unknown as Response
}

function lastInit(): RequestInit {
  return fetchMock.mock.calls.at(-1)?.[1] as RequestInit
}

beforeEach(() => {
  savedEnv = { ...process.env }
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(okResponse())
  vi.stubGlobal('fetch', fetchMock)
  configure({
    ALICORN_CONTROL_API_URL: 'https://control.example.com',
    ALICORN_LEDGER_API_URL: 'https://ledger.example.com',
    ALICORN_LOCAL_API_TOKEN: TOKEN,
    ALICORN_TENANT_ID: 'tenant-1'
  })
})

afterEach(() => {
  process.env = savedEnv
  vi.unstubAllGlobals()
})

describe('alicornFetch routing', () => {
  it('sends control calls to the control API', async () => {
    await alicornFetch('control', '/v1/members')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://control.example.com/v1/members')
  })

  it('sends ledger calls to the ledger API', async () => {
    await alicornFetch('ledger', '/v1/step-outcomes')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ledger.example.com/v1/step-outcomes')
  })
})

describe('alicornFetch headers', () => {
  it('carries the bearer and the org', async () => {
    await alicornFetch('control', '/v1/members')

    const headers = new Headers(lastInit().headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('x-alicorn-org')).toBe('tenant-1')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('refuses to follow a redirect so the bearer cannot be replayed elsewhere', async () => {
    await alicornFetch('control', '/v1/members')
    expect(lastInit().redirect).toBe('error')
  })

  it('applies a timeout when the caller supplies no signal', async () => {
    await alicornFetch('control', '/v1/members')
    expect(lastInit().signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps a caller signal so a cancelled read is not overridden', async () => {
    const controller = new AbortController()
    await alicornFetch('control', '/v1/members', { signal: controller.signal })
    expect(lastInit().signal).toBe(controller.signal)
  })

  it('preserves caller headers and method', async () => {
    await alicornFetch('control', '/v1/members', {
      method: 'POST',
      headers: { 'x-request-id': 'req-1' }
    })

    expect(lastInit().method).toBe('POST')
    expect(new Headers(lastInit().headers).get('x-request-id')).toBe('req-1')
  })
})

describe('alicornFetch failures', () => {
  it('throws unconfigured when the control URL is missing', async () => {
    configure({ ALICORN_LOCAL_API_TOKEN: TOKEN })

    await expect(alicornFetch('control', '/v1/members')).rejects.toBeInstanceOf(
      ControlPlaneUnavailableError
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws unconfigured when the bearer is missing', async () => {
    configure({ ALICORN_CONTROL_API_URL: 'https://control.example.com' })

    const error = await alicornFetch('control', '/v1/members').catch((thrown) => thrown)
    expect(error).toBeInstanceOf(ControlPlaneUnavailableError)
    expect((error as ControlPlaneUnavailableError).code).toBe('control_plane_unconfigured')
  })

  it('takes the error code from the body', async () => {
    fetchMock.mockResolvedValue(errorResponse(403, { error: 'not_a_member' }))

    const error = await alicornFetch('control', '/v1/members').catch((thrown) => thrown)
    expect(error).toBeInstanceOf(ControlPlaneRequestError)
    expect((error as ControlPlaneRequestError).status).toBe(403)
    expect((error as ControlPlaneRequestError).code).toBe('not_a_member')
  })

  it('falls back to the status text when the body carries no error', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, {}, 'Internal Server Error'))

    const error = await alicornFetch('control', '/v1/x').catch((thrown) => thrown)
    expect((error as ControlPlaneRequestError).code).toBe('Internal Server Error')
  })

  it('falls back to the status when the body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: '',
      json: async () => {
        throw new Error('not json')
      }
    } as unknown as Response)

    const error = await alicornFetch('control', '/v1/x').catch((thrown) => thrown)
    expect((error as ControlPlaneRequestError).code).toBe('502')
  })

  it('returns the response untouched on success', async () => {
    const response = okResponse()
    fetchMock.mockResolvedValue(response)

    await expect(alicornFetch('control', '/v1/members')).resolves.toBe(response)
  })
})
