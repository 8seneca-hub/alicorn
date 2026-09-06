import type { ControlPlaneClient } from './control-plane-client'
import type { Member, OrgPolicy, RequiredCheck } from '../../shared/alicorn/members'

const DEFAULT_TTL_MS = 60_000

// Why fail closed: if the org policy cannot be read we cannot show that a
// reviewer is on a different backend, and the expensive mistake is letting a
// model review its own work (PROJECT-BRIEF §11.4).
const FAIL_CLOSED_POLICY: OrgPolicy = { enforceDistinctReviewerBackend: true }

export type MemberDirectory = {
  getMember: (id: string) => Promise<Member | null>
  getOrgPolicy: () => Promise<OrgPolicy>
  getRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
}

type Cached<T> = { value: T; fetchedAt: number }

export function createMemberDirectory(
  client: ControlPlaneClient,
  opts?: { ttlMs?: number; now?: () => number }
): MemberDirectory {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS
  const now = opts?.now ?? Date.now
  let members: Cached<Member[]> | null = null
  let policy: Cached<OrgPolicy> | null = null
  const checks = new Map<string, Cached<RequiredCheck[]>>()

  // A launch is worth more than a fresh read: when a refresh fails, serve the
  // last known answer rather than failing the dispatch. Only a cold cache throws.
  async function refresh<T>(
    cached: Cached<T> | null | undefined,
    read: () => Promise<T>,
    store: (entry: Cached<T>) => void
  ): Promise<T> {
    if (cached && now() - cached.fetchedAt < ttlMs) {
      return cached.value
    }
    try {
      const value = await read()
      store({ value, fetchedAt: now() })
      return value
    } catch (error) {
      if (cached) {
        return cached.value
      }
      throw error
    }
  }

  return {
    getMember: async (id) => {
      const list = await refresh(
        members,
        () => client.listMembers(),
        (entry) => {
          members = entry
        }
      )
      return list.find((member) => member.id === id) ?? null
    },

    getOrgPolicy: async () => {
      try {
        return await refresh(
          policy,
          () => client.getOrgPolicy(),
          (entry) => {
            policy = entry
          }
        )
      } catch (error) {
        console.warn('[alicorn] org policy unavailable — enforcing reviewer backend', error)
        return FAIL_CLOSED_POLICY
      }
    },

    getRequiredChecks: async (projectId) =>
      refresh(
        checks.get(projectId),
        () => client.getRequiredChecks(projectId),
        (entry) => {
          checks.set(projectId, entry)
        }
      )
  }
}
