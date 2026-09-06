import { alicornFetch } from '../control-plane-http'
import type { RequiredCheck } from '../../../shared/alicorn/members'

// R9: depends on B1's alicornFetch only, never B2's MemberDirectory/control-plane-client.
export async function fetchRequiredChecks(projectId: string): Promise<RequiredCheck[]> {
  const res = await alicornFetch('control', `/v1/projects/${projectId}/required-checks`)
  return (await res.json()).checks
}
