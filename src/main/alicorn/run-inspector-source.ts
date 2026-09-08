import type { ControlPlaneClient } from './control-plane-client'
import { readProvenanceView } from './provenance-source'
import {
  buildRunInspectorView,
  selectRunId,
  type RunInspectorView
} from '../../shared/alicorn/run-inspector-view'

/**
 * UI3's read. It starts from `readProvenanceView` — the same assembly PV1's panel and D6's
 * pull-request body use — and adds only what is keyed by run rather than by branch: the run's
 * context captures and its cost.
 *
 * The capture list is read for its *metadata*. Bodies are dropped by `buildRunInspectorView`
 * before anything crosses IPC; one body is fetched later, by dispatch, when a reader opens it.
 *
 * Captures and cost are read tolerantly: a branch's steps are worth showing even when the capture
 * table is unreachable, and the projection renders "not captured" rather than claiming a figure.
 */
export async function readRunInspectorView(
  client: ControlPlaneClient,
  repoId: string,
  branch: string,
  requestedRunId?: string | null
): Promise<RunInspectorView | null> {
  const provenance = await readProvenanceView(client, repoId, branch)
  if (!provenance) {
    return null
  }
  const runId = selectRunId(provenance, requestedRunId)
  if (!runId) {
    // No settled step on this branch: a view with no run, not an error and not a missing read.
    return buildRunInspectorView(provenance, { runId: '', captures: null, cost: null })
  }
  const [captures, cost] = await Promise.all([
    client.listRunContextCaptures(runId).catch(() => null),
    client.getRunCost(runId).catch(() => null)
  ])
  return buildRunInspectorView(provenance, { runId, captures, cost })
}
