import type { ControlPlaneClient } from './control-plane-client'
import { buildProvenanceView, type ProvenanceView } from '../../shared/alicorn/provenance-view'

/**
 * The one read path for a branch's provenance: the ledger report, the org's reviewer-backend
 * policy, and the member directory, projected into `ProvenanceView`.
 *
 * Both surfaces go through here — D6's pull-request body and PV1's panel — so the fail-closed
 * policy fallback below is decided once. Claiming the reviewer rule was off when we merely could
 * not read it would understate a bypass, which is the one direction that must never happen.
 *
 * Throws only what B1's client throws; the ledger being empty is a view with no steps, not an error.
 */
export async function readProvenanceView(
  client: ControlPlaneClient,
  repoId: string,
  branch: string
): Promise<ProvenanceView | null> {
  const report = await client.getProvenance(repoId, branch).catch(() => null)
  if (!report) {
    return null
  }
  const policy = await client.getOrgPolicy().catch(() => ({ enforceDistinctReviewerBackend: true }))
  const members = await client.listMembers().catch(() => [])
  const nameById = new Map(members.map((member) => [member.id, member.name] as const))
  return buildProvenanceView(report, {
    policyEnforced: policy.enforceDistinctReviewerBackend,
    memberName: (id) => nameById.get(id)
  })
}
