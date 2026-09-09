import { describe, expect, it, vi } from 'vitest'
import { proposeTeam, type TeamProposalDirectory } from './team-proposal-source'
import type { Member, MemberBackend, MemberRole } from '../../../shared/alicorn/members'

function member(id: string, role: MemberRole, backend: MemberBackend): Member {
  return {
    id,
    name: id,
    role,
    backend,
    workspaceKind: 'worktree',
    permissionMode: 'ask',
    systemRules: '',
    skills: [],
    tenantId: 'local',
    createdBy: 'test',
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z'
  }
}

const POOL = [
  member('dev-a', 'developer', 'claude'),
  member('dev-b', 'developer', 'claude'),
  member('rev-1', 'reviewer', 'codex'),
  member('qa-1', 'qa', 'grok'),
  member('an-1', 'analyst', 'claude')
]

function directory(getTrackRecord: TeamProposalDirectory['getTrackRecord']): TeamProposalDirectory {
  return { listMembers: vi.fn().mockResolvedValue(POOL), getTrackRecord }
}

describe('proposeTeam', () => {
  it('ranks each candidate on the window of its own seat stage', async () => {
    const getTrackRecord = vi.fn(async (key: { memberId: string; stageKey: string }) => ({
      memberId: key.memberId,
      stageKey: key.stageKey,
      acceptRate: key.memberId === 'dev-b' ? 0.9 : 0.4,
      runs: 10
    }))
    const team = await proposeTeam({
      directory: directory(getTrackRecord as never),
      projectId: 'proj-1',
      goal: 'Ship it'
    })

    expect(team.seats.find((seat) => seat.role === 'developer')?.memberId).toBe('dev-b')
    // The analyst is not a seat, so nobody pays a ledger read for it.
    expect(getTrackRecord.mock.calls.map((call) => call[0].memberId)).not.toContain('an-1')
    expect(
      getTrackRecord.mock.calls.find((call) => call[0].memberId === 'rev-1')?.[0].stageKey
    ).toBe('review')
  })

  it('treats an unreadable window as unmeasured rather than as a zero rate', async () => {
    const getTrackRecord = vi.fn(async (key: { memberId: string; stageKey: string }) => {
      if (key.memberId === 'dev-a') {
        throw new Error('ledger unreachable')
      }
      return { memberId: key.memberId, stageKey: key.stageKey, acceptRate: 0.2, runs: 4 }
    })
    const team = await proposeTeam({
      directory: directory(getTrackRecord as never),
      projectId: 'proj-1',
      goal: ''
    })

    // dev-b is measured at 20%, dev-a is unmeasured — measured still wins, and nothing threw.
    expect(team.seats.find((seat) => seat.role === 'developer')?.memberId).toBe('dev-b')
  })

  it('says so, as a gap, when there is no project to rank in', async () => {
    const team = await proposeTeam({
      directory: directory(vi.fn() as never),
      projectId: null,
      goal: ''
    })

    expect(team.seats.every((seat) => seat.acceptRate === null)).toBe(true)
    expect(team.gaps.some((gap) => gap.includes('role coverage only'))).toBe(true)
  })

  it('fails rather than proposing an empty team when the member list cannot be read', async () => {
    await expect(
      proposeTeam({
        directory: {
          listMembers: vi.fn().mockRejectedValue(new Error('control plane down')),
          getTrackRecord: vi.fn()
        },
        projectId: 'proj-1',
        goal: ''
      })
    ).rejects.toThrow('control plane down')
  })
})
