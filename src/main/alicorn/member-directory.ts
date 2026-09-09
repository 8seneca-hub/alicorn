import type { ControlPlaneClient } from './control-plane-client'
import type { Member, OrgPolicy, RequiredCheck } from '../../shared/alicorn/members'
import type { ProtectedPath } from '../../shared/alicorn/protected-paths'
import type {
  AutonomyPolicy,
  AutonomyPolicyInput,
  StageConfig,
  TrackRecord
} from '../../shared/alicorn/gate-policy'

const DEFAULT_TTL_MS = 60_000

// Why fail closed: if the org policy cannot be read we cannot show that a
// reviewer is on a different backend, and the expensive mistake is letting a
// model review its own work (PROJECT-BRIEF §11.4).
const FAIL_CLOSED_POLICY: OrgPolicy = { enforceDistinctReviewerBackend: true }

export type MemberDirectory = {
  getMember: (id: string) => Promise<Member | null>
  /** RB2's read: the team a lead may dispatch. Same cached list `getMember` resolves against. */
  listMembers: () => Promise<Member[]>
  getOrgPolicy: () => Promise<OrgPolicy>
  getRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
  // BR1's reach surface. Same no-fallback posture as the policy: an unreadable surface throws so
  // the gate caller fails safe, rather than being handed an empty list that reads as "nothing is
  // protected" — the one wrong answer here.
  getProtectedPaths: (projectId: string) => Promise<ProtectedPath[]>
  // Gate policy (GP1). Deliberately no fail-closed fallback here: a gate caller has to tell an
  // absent policy (null, apply the default) from an unreadable one (throws, fail safe to a gate),
  // and swallowing the error here would collapse the two.
  getAutonomyPolicy: (key: {
    projectId: string
    stageKey: string
    memberId: string | null
  }) => Promise<AutonomyPolicy | null>
  getStageConfig: (projectId: string, stageKey: string) => Promise<StageConfig>
  /** GP2's audit read: every authored policy, lapsed `never_gate` exceptions included. */
  listAutonomyPolicies: (projectId: string) => Promise<AutonomyPolicy[]>
  /** The only write here. Drops the cached reads it invalidates so a set is visible to the next get. */
  setAutonomyPolicy: (projectId: string, input: AutonomyPolicyInput) => Promise<AutonomyPolicy>
  // Same no-fallback posture as getAutonomyPolicy: an unreachable ledger throws so the caller can
  // gate on `history`, rather than being handed a zeroed record that reads as a real empty one.
  getTrackRecord: (key: {
    projectId: string
    stageKey: string
    memberId: string
  }) => Promise<TrackRecord>
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
  const protectedPaths = new Map<string, Cached<ProtectedPath[]>>()
  const policies = new Map<string, Cached<AutonomyPolicy | null>>()
  const stageConfigs = new Map<string, Cached<StageConfig>>()
  const authoredPolicies = new Map<string, Cached<AutonomyPolicy[]>>()
  const trackRecords = new Map<string, Cached<TrackRecord>>()

  function policyCacheKey(key: {
    projectId: string
    stageKey: string
    memberId: string | null
  }): string {
    return `${key.projectId}\u0000${key.stageKey}\u0000${key.memberId ?? ''}`
  }

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

  const readMembers = (): Promise<Member[]> =>
    refresh(
      members,
      () => client.listMembers(),
      (entry) => {
        members = entry
      }
    )

  return {
    getMember: async (id) => (await readMembers()).find((member) => member.id === id) ?? null,

    listMembers: readMembers,

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
      ),

    getProtectedPaths: async (projectId) =>
      refresh(
        protectedPaths.get(projectId),
        () => client.getProtectedPaths(projectId),
        (entry) => {
          protectedPaths.set(projectId, entry)
        }
      ),

    getAutonomyPolicy: async (key) => {
      const cacheKey = policyCacheKey(key)
      return refresh(
        policies.get(cacheKey),
        () => client.getAutonomyPolicy(key),
        (entry) => {
          policies.set(cacheKey, entry)
        }
      )
    },

    listAutonomyPolicies: async (projectId) =>
      refresh(
        authoredPolicies.get(projectId),
        () => client.listAutonomyPolicies(projectId),
        (entry) => {
          authoredPolicies.set(projectId, entry)
        }
      ),

    setAutonomyPolicy: async (projectId, input) => {
      const written = await client.putAutonomyPolicy(projectId, input)
      // Evict rather than store the response: the wildcard row this write replaced may also be
      // cached under a member-specific key, and only a re-read can say which row now applies.
      policies.clear()
      authoredPolicies.delete(projectId)
      return written
    },

    getTrackRecord: async (key) =>
      refresh(
        trackRecords.get(policyCacheKey(key)),
        () => client.getTrackRecord(key),
        (entry) => {
          trackRecords.set(policyCacheKey(key), entry)
        }
      ),

    getStageConfig: async (projectId, stageKey) => {
      const cacheKey = `${projectId}\u0000${stageKey}`
      return refresh(
        stageConfigs.get(cacheKey),
        () => client.getStageConfig(projectId, stageKey),
        (entry) => {
          stageConfigs.set(cacheKey, entry)
        }
      )
    }
  }
}
