import { CapabilityProbeCache } from '../../shared/capability-probe-cache'
import { PlaneApiError, type PlaneClient } from './plane-request'

// Plane v1.1.0 renamed the issue routes to /work-items/. /issues/ still
// resolves on every release including current ones, but is marked deprecated in
// Plane's source and is no longer documented; /work-items/ 404s on v1.0.0 and
// older. Probe the current path per deployment and remember the answer.
const ISSUE_ENDPOINT_RETRY_INTERVAL_MS = 60 * 60 * 1000

export const WORK_ITEM_SEGMENT = 'work-items'
export const LEGACY_ISSUE_SEGMENT = 'issues'

const issueEndpointCache = new CapabilityProbeCache<string>(ISSUE_ENDPOINT_RETRY_INTERVAL_MS)

// Plane answers both "this route does not exist" and "this work item does not
// exist" with a 404, so a detail read for a missing issue can be misread as a
// missing route. That misread is deliberately tolerated: the fallback path
// resolves on every Plane release, so the cost is one extra request and an hour
// of using the older path, and the 404 still surfaces to the caller either way.
function isMissingIssueEndpoint(error: unknown): boolean {
  return error instanceof PlaneApiError && error.status === 404
}

export async function withIssueSegment<T>(
  client: PlaneClient,
  run: (segment: string) => Promise<T>
): Promise<T> {
  return issueEndpointCache.runWithFallback(
    // Keyed per connection: two deployments can be different Plane versions.
    client.connectionId,
    () => run(WORK_ITEM_SEGMENT),
    () => run(LEGACY_ISSUE_SEGMENT),
    isMissingIssueEndpoint
  )
}

export function resetPlaneIssueEndpointCacheForTests(): void {
  issueEndpointCache.clear()
}
