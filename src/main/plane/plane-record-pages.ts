import { planeRequest, type PlaneClient } from './plane-request'

// Plane wraps every list endpoint in this envelope. `next_cursor` is opaque and
// must be echoed back verbatim; `next_page_results` is the only reliable
// end-of-list signal, because the last page still carries a cursor.
export type PlanePagedResponse<T> = {
  results?: T[]
  count?: number
  total_count?: number
  next_cursor?: string | null
  next_page_results?: boolean
}

export type PlaneRecord = Record<string, unknown>

// Plane caps a page at 100; anything larger is silently clamped server-side.
const MAX_PER_PAGE = 100
// Bounds a paginated read so a misbehaving deployment cannot spin forever.
const MAX_PAGES = 50

export function asRecord(value: unknown): PlaneRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PlaneRecord) : {}
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value)
    }
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

export async function fetchAllPages<T>(
  client: PlaneClient,
  path: string,
  options?: { perPage?: number; signal?: AbortSignal }
): Promise<T[]> {
  const perPage = Math.min(options?.perPage ?? MAX_PER_PAGE, MAX_PER_PAGE)
  const collected: T[] = []
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await planeRequest<PlanePagedResponse<T>>(
      client,
      withQuery(path, { per_page: String(perPage), cursor }),
      options?.signal ? { signal: options.signal } : undefined
    )
    collected.push(...(response?.results ?? []))
    if (!response?.next_page_results || !response.next_cursor) {
      return collected
    }
    cursor = response.next_cursor
  }

  return collected
}
