import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemberDirectory } from './member-directory'
import type { ControlPlaneClient } from './control-plane-client'
import type { Member } from '../../shared/alicorn/members'

const MEMBER: Member = {
  id: 'm1',
  tenantId: 'local',
  createdBy: 'actor',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  name: 'Reviewer',
  role: 'reviewer',
  backend: 'codex',
  workspaceKind: 'worktree',
  permissionMode: 'ask',
  systemRules: '',
  skills: []
}

const listMembers = vi.fn()
const getOrgPolicy = vi.fn()
const getRequiredChecks = vi.fn()
const getAutonomyPolicy = vi.fn()
const listAutonomyPolicies = vi.fn()
const putAutonomyPolicy = vi.fn()
const getTrackRecord = vi.fn()
let clock = 0

const POLICY_KEY = { projectId: 'p1', stageKey: 'build', memberId: null }
const POLICY_INPUT = {
  stageKey: 'build',
  memberId: null,
  mode: 'evidence' as const,
  minRuns: 10,
  minAcceptRate: 0.9,
  maxFiles: null,
  maxSpendCents: null,
  expiresAt: null
}

function directory(ttlMs = 60_000) {
  return createMemberDirectory(
    {
      listMembers,
      getOrgPolicy,
      getRequiredChecks,
      getAutonomyPolicy,
      listAutonomyPolicies,
      putAutonomyPolicy,
      getTrackRecord
    } as unknown as ControlPlaneClient,
    { ttlMs, now: () => clock }
  )
}

beforeEach(() => {
  clock = 0
  listMembers.mockReset().mockResolvedValue([MEMBER])
  getOrgPolicy.mockReset().mockResolvedValue({ enforceDistinctReviewerBackend: false })
  getRequiredChecks.mockReset().mockResolvedValue([])
  getAutonomyPolicy.mockReset().mockResolvedValue(null)
  listAutonomyPolicies.mockReset().mockResolvedValue([])
  putAutonomyPolicy.mockReset().mockResolvedValue({ ...POLICY_INPUT, createdBy: 'actor' })
  getTrackRecord.mockReset().mockResolvedValue({ runs: 3 })
})

describe('caching', () => {
  it('reads once inside the TTL', async () => {
    const dir = directory()

    await dir.getMember('m1')
    clock = 59_999
    await dir.getMember('m1')

    expect(listMembers).toHaveBeenCalledTimes(1)
  })

  it('re-reads once the TTL has passed', async () => {
    const dir = directory()

    await dir.getMember('m1')
    clock = 60_001
    await dir.getMember('m1')

    expect(listMembers).toHaveBeenCalledTimes(2)
  })

  it('caches required checks per project', async () => {
    const dir = directory()

    await dir.getRequiredChecks('p1')
    await dir.getRequiredChecks('p1')
    await dir.getRequiredChecks('p2')

    expect(getRequiredChecks).toHaveBeenCalledTimes(2)
  })

  it('returns null for a member the org does not have', async () => {
    await expect(directory().getMember('nope')).resolves.toBeNull()
  })
})

describe('failure handling', () => {
  it('serves the stale value rather than failing a launch', async () => {
    const dir = directory()
    await dir.getMember('m1')
    clock = 60_001
    listMembers.mockRejectedValue(new Error('offline'))

    await expect(dir.getMember('m1')).resolves.toEqual(MEMBER)
  })

  it('throws when the cache is cold and the read fails', async () => {
    listMembers.mockRejectedValue(new Error('offline'))

    await expect(directory().getMember('m1')).rejects.toThrow('offline')
  })

  it('enforces the reviewer rule when the policy cannot be read at all', async () => {
    getOrgPolicy.mockRejectedValue(new Error('offline'))

    // Fail closed: unable to prove the reviewer is on a different backend, the
    // expensive mistake is letting a model review its own work.
    await expect(directory().getOrgPolicy()).resolves.toEqual({
      enforceDistinctReviewerBackend: true
    })
  })

  it('prefers a stale policy over failing closed', async () => {
    const dir = directory()
    await dir.getOrgPolicy()
    clock = 60_001
    getOrgPolicy.mockRejectedValue(new Error('offline'))

    await expect(dir.getOrgPolicy()).resolves.toEqual({ enforceDistinctReviewerBackend: false })
  })
})

describe('autonomy policy and track record', () => {
  it('caches the track record per project, stage and member', async () => {
    const dir = directory()
    const key = { projectId: 'p1', stageKey: 'build', memberId: 'm1' }

    await dir.getTrackRecord(key)
    await dir.getTrackRecord(key)
    await dir.getTrackRecord({ ...key, stageKey: 'review' })

    expect(getTrackRecord).toHaveBeenCalledTimes(2)
  })

  it('lets a policy write be seen by the next read', async () => {
    const dir = directory()
    await dir.getAutonomyPolicy(POLICY_KEY)
    await dir.listAutonomyPolicies('p1')

    getAutonomyPolicy.mockResolvedValue({ ...POLICY_INPUT, mode: 'always_gate' })
    await dir.setAutonomyPolicy('p1', { ...POLICY_INPUT, mode: 'always_gate' })

    // Still inside the TTL: only the eviction makes the write visible.
    await expect(dir.getAutonomyPolicy(POLICY_KEY)).resolves.toMatchObject({
      mode: 'always_gate'
    })
    await dir.listAutonomyPolicies('p1')
    expect(listAutonomyPolicies).toHaveBeenCalledTimes(2)
  })

  it('evicts a member-specific policy when the stage wildcard is rewritten', async () => {
    const dir = directory()
    await dir.getAutonomyPolicy({ ...POLICY_KEY, memberId: 'm1' })
    await dir.setAutonomyPolicy('p1', POLICY_INPUT)
    await dir.getAutonomyPolicy({ ...POLICY_KEY, memberId: 'm1' })

    expect(getAutonomyPolicy).toHaveBeenCalledTimes(2)
  })

  it('does not swallow an unreadable track record into an empty one', async () => {
    getTrackRecord.mockRejectedValue(new Error('offline'))

    await expect(
      directory().getTrackRecord({ projectId: 'p1', stageKey: 'build', memberId: 'm1' })
    ).rejects.toThrow('offline')
  })
})
