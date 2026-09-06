import { getMainHttpClient } from '../network/http-client'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { withSpan } from '../observability/tracer'

// Plane authenticates REST calls with a workspace API key in this header;
// there is no Authorization/Bearer form for API keys.
const PLANE_API_KEY_HEADER = 'X-API-Key'
const PLANE_API_USER_AGENT = 'Orca'
const PLANE_API_VERSION_PATH = '/api/v1'

export type PlaneClient = {
  connectionId: string
  baseUrl: string
  workspaceSlug: string
  apiKey: string
}

export class PlaneApiError extends Error {
  status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'PlaneApiError'
    this.status = status
  }
}

// Every Plane path is built here so a deployment that mounts the API
// elsewhere is a one-line change rather than a grep across the module.
export function workspacePath(workspaceSlug: string, suffix = ''): string {
  return `${PLANE_API_VERSION_PATH}/workspaces/${encodeURIComponent(workspaceSlug)}/${suffix}`
}

export function projectPath(workspaceSlug: string, projectId: string, suffix = ''): string {
  return workspacePath(workspaceSlug, `projects/${encodeURIComponent(projectId)}/${suffix}`)
}

async function planeFetch(url: string, init: RequestInit): Promise<Response> {
  return withSpan(
    'plane.request',
    async (span) => {
      span.setAttribute('plane.baseUrl', new URL(url).origin)
      const httpClient = getMainHttpClient()
      const proxySession = httpClient.proxySession()
      await ensureElectronProxyFromEnvironment({
        ...(proxySession ? { proxySession } : {}),
        probeUrl: url
      }).catch((error) => {
        span.addEvent('plane.proxySetupFailed', {
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error)
        })
      })
      try {
        return await httpClient.fetch(url, init)
      } catch (error) {
        span.setAttribute(
          'plane.transportErrorName',
          error instanceof Error ? error.name : typeof error
        )
        span.setAttribute(
          'plane.transportErrorMessage',
          error instanceof Error ? error.message : String(error)
        )
        throw error
      }
    },
    { kind: 'client' }
  )
}

export async function requestWithKey<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  headers.set('Content-Type', 'application/json')
  headers.set('User-Agent', PLANE_API_USER_AGENT)
  headers.set(PLANE_API_KEY_HEADER, apiKey)
  const response = await planeFetch(`${baseUrl}${path}`, { ...init, headers })
  if (!response.ok) {
    throw new PlaneApiError(await readPlaneError(response), response.status)
  }
  if (response.status === 204) {
    return null as T
  }
  return (await response.json()) as T
}

export async function planeRequest<T>(
  client: PlaneClient,
  path: string,
  init?: RequestInit
): Promise<T> {
  return requestWithKey<T>(client.baseUrl, client.apiKey, path, init)
}

async function readPlaneError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      detail?: unknown
      error?: unknown
      message?: unknown
      [field: string]: unknown
    }
    const direct = [data.detail, data.error, data.message].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    if (direct.length > 0) {
      return direct.join('; ')
    }
    // Plane's DRF serializers report field errors as { field: ["msg", ...] }.
    const fieldErrors = Object.entries(data)
      .filter(([, value]) => Array.isArray(value))
      .map(([field, value]) => `${field}: ${(value as unknown[]).join(', ')}`)
    if (fieldErrors.length > 0) {
      return fieldErrors.join('; ')
    }
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `Plane request failed (${response.status})`
}
