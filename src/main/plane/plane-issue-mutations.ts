import type { PlaneIssue } from '../../shared/plane-types'
import { asRecord } from './plane-record-pages'
import { mapPlaneIssue } from './plane-issue-queries'
import { planeRequest, projectPath, type PlaneClient } from './plane-request'
import { withIssueSegment } from './plane-issue-endpoint'

/**
 * Moves a work item to a state. This is the only write Alicorn makes to Plane: the board is the
 * source of truth for what a card's column means, and the issue state is the mirror.
 *
 * Goes through PP1's endpoint probe, so a Plane older than v1.1.0 — which only answers `/issues/` —
 * is written to on the route it actually has.
 */
export async function updateIssueState(
  client: PlaneClient,
  projectId: string,
  issueId: string,
  stateId: string,
  options?: { projectIdentifier?: string; signal?: AbortSignal }
): Promise<PlaneIssue | null> {
  const record = await withIssueSegment(client, (segment) =>
    planeRequest<unknown>(
      client,
      projectPath(client.workspaceSlug, projectId, `${segment}/${encodeURIComponent(issueId)}/`),
      {
        method: 'PATCH',
        body: JSON.stringify({ state: stateId }),
        ...(options?.signal ? { signal: options.signal } : {})
      }
    )
  )
  return mapPlaneIssue(asRecord(record), client, options?.projectIdentifier)
}
