import { alicornFetch } from '../control-plane-http'

/** CR2's read half. Same `alicornFetch` seam as `fetchRequiredChecks` — never the member directory. */
export async function fetchAcknowledgedContractNames(
  projectId: string,
  runId: string
): Promise<string[]> {
  const res = await alicornFetch(
    'control',
    // Project ids look like `github:owner/repo`; a raw `/` would split Hono's `:projectId`.
    `/v1/projects/${encodeURIComponent(projectId)}/contracts/acknowledgements?runId=${encodeURIComponent(runId)}`
  )
  const body = await res.json()
  if (!Array.isArray(body.acknowledgements)) {
    throw new Error('contract acknowledgements response has no acknowledgements array')
  }
  return body.acknowledgements.map((row: { contractName: string }) => row.contractName)
}
