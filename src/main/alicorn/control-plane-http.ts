import { getAlicornControlPlaneUrls } from './control-plane-urls'
import { readAlicornBearer } from './control-plane-session'

export type AlicornService = 'control' | 'ledger'

const REQUEST_TIMEOUT_MS = 15_000

export class ControlPlaneUnavailableError extends Error {
  readonly code: string

  constructor(code = 'control_plane_unconfigured') {
    super(code)
    this.name = 'ControlPlaneUnavailableError'
    this.code = code
  }
}

export class ControlPlaneRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(`${status} ${code}`)
    this.name = 'ControlPlaneRequestError'
    this.status = status
    this.code = code
  }
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body?.error === 'string' && body.error.length > 0) {
      return body.error
    }
  } catch {
    // A non-JSON error body is normal for a proxy or gateway failure.
  }
  return response.statusText || String(response.status)
}

/**
 * The only way any desktop module reaches the control plane. Both the members
 * client (B2) and the ledger writer (C3) build on this and neither imports the
 * other, so auth, timeouts and error shape are decided in exactly one place.
 */
export async function alicornFetch(
  service: AlicornService,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const urls = getAlicornControlPlaneUrls(process.env)
  const bearer = readAlicornBearer(process.env)
  if (!urls || !bearer) {
    throw new ControlPlaneUnavailableError()
  }
  const baseUrl = service === 'ledger' ? urls.ledgerApiUrl : urls.controlApiUrl
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${bearer.accessToken}`)
  headers.set('x-alicorn-org', bearer.orgId)
  headers.set('content-type', 'application/json')
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    // Why: a redirect would replay the bearer at whatever host the response
    // names, so a misconfigured deployment cannot leak the credential.
    redirect: 'error',
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new ControlPlaneRequestError(response.status, await readErrorCode(response))
  }
  return response
}
