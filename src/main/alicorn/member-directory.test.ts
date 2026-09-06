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
let clock = 0

function directory(ttlMs = 60_000) {
  return createMemberDirectory(
    { listMembers, getOrgPolicy, getRequiredChecks } as unknown as ControlPlaneClient,
    { ttlMs, now: () => clock }
  )
}

beforeEach(() => {
  clock = 0
  listMembers.mockReset().mockResolvedValue([MEMBER])
  getOrgPolicy.mockReset().mockResolvedValue({ enforceDistinctReviewerBackend: false })
  getRequiredChecks.mockReset().mockResolvedValue([])
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
