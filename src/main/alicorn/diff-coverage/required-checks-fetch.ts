import { alicornFetch } from '../control-plane-http'
import type { RequiredCheck } from '../../../shared/alicorn/members'

// R9: depends on B1's alicornFetch only, never B2's MemberDirectory/control-plane-client.
export async function fetchRequiredChecks(projectId: string): Promise<RequiredCheck[]> {
  // Why encode: project ids look like `github:owner/repo` or `git:<key>` — the raw
  // `/` would split Hono's `:projectId` path segment and 404 forever.
  const res = await alicornFetch(
    'control',
    `/v1/projects/${encodeURIComponent(projectId)}/required-checks`
  )
  const body = await res.json()
  if (!Array.isArray(body.checks)) {
    throw new Error('required-checks response has no checks array')
  }
  return body.checks
}
