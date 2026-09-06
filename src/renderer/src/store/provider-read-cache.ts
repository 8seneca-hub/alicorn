import type { CacheEntry } from './github/cache-model'

// Freshness and eviction for a task provider's read cache. Linear and Jira each
// carry a private, byte-identical copy of these; this is the shared one so a
// fifth provider does not add a fifth. Migrating the existing two is a separate
// change — they work, and moving them is not free.
export const PROVIDER_CACHE_TTL_MS = 60_000
export const PROVIDER_MAX_CACHE_ENTRIES = 500

export function isFreshCacheEntry<T>(
  entry: CacheEntry<T> | undefined,
  ttlMs = PROVIDER_CACHE_TTL_MS
): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() - entry.fetchedAt < ttlMs
}

export function evictStaleCacheEntries<T>(
  cache: Record<string, CacheEntry<T>>,
  maxEntries = PROVIDER_MAX_CACHE_ENTRIES
): Record<string, CacheEntry<T>> {
  const keys = Object.keys(cache)
  if (keys.length <= maxEntries) {
    return cache
  }
  const sorted = keys.sort(
    (left, right) => (cache[left]?.fetchedAt ?? 0) - (cache[right]?.fetchedAt ?? 0)
  )
  const pruned: Record<string, CacheEntry<T>> = {}
  for (const key of sorted.slice(sorted.length - maxEntries)) {
    pruned[key] = cache[key]
  }
  return pruned
}

// An auth failure must clear the connection rather than surface as a read
// error, or the UI keeps showing a stale list under a credential that no
// longer works.
export function looksLikeProviderAuthError(error: string | null | undefined): boolean {
  return /authenticat|unauthorized|401|403/i.test(error ?? '')
}
