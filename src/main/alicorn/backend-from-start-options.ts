import { MEMBER_BACKENDS, type MemberBackend } from '../../shared/alicorn/members'

const BACKENDS = new Set<string>(MEMBER_BACKENDS)

/**
 * The backend a dispatch ran on, read from its worker start options. Shared by
 * the reviewer-backend rule and the ledger step-outcome builder so both classify
 * a run the same way.
 *
 * `other` covers agents Alicorn launches but Alicorn does not price or police.
 */
export function backendFromWorkerStartOptions(
  startOptions: string | null | undefined
): MemberBackend | 'other' {
  if (!startOptions) {
    return 'other'
  }
  try {
    const parsed = JSON.parse(startOptions) as { agent?: unknown }
    const agent = parsed?.agent
    return typeof agent === 'string' && BACKENDS.has(agent) ? (agent as MemberBackend) : 'other'
  } catch {
    return 'other'
  }
}
