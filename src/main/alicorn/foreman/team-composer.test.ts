import { describe, expect, it } from 'vitest'
import {
  composeTeam,
  isTeamAccepted,
  renderTeamGateQuestion,
  TEAM_SEAT_ROLES,
  type SeatTrackRecord
} from './team-composer'
import type { Member, MemberBackend, MemberRole } from '../../../shared/alicorn/members'

function member(id: string, role: MemberRole, backend: MemberBackend, name = id): Member {
  return {
    id,
    name,
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

function window_(
  memberId: string,
  stageKey: string,
  acceptRate: number,
  runs: number
): SeatTrackRecord {
  return { memberId, stageKey, acceptRate, runs }
}

const seatOf = (team: ReturnType<typeof composeTeam>, role: string) =>
  team.seats.find((seat) => seat.role === role)!

describe('composeTeam', () => {
  it('fills one seat per required role', () => {
    const team = composeTeam({
      goal: 'Ship AT1',
      members: [
        member('dev-1', 'developer', 'claude'),
        member('rev-1', 'reviewer', 'codex'),
        member('qa-1', 'qa', 'claude'),
        member('an-1', 'analyst', 'grok')
      ],
      trackRecords: []
    })

    expect(team.seats.map((seat) => seat.role)).toEqual([...TEAM_SEAT_ROLES])
    expect(team.seats.map((seat) => seat.memberId)).toEqual(['dev-1', 'rev-1', 'qa-1'])
    expect(team.gaps).toEqual([])
    expect(team.goal).toBe('Ship AT1')
  })

  it('measures each seat under its own authored stage key', () => {
    const team = composeTeam({
      goal: '',
      members: [
        member('dev-1', 'developer', 'claude'),
        member('rev-1', 'reviewer', 'codex'),
        member('qa-1', 'qa', 'grok')
      ],
      trackRecords: []
    })

    expect(team.seats.map((seat) => seat.stageKey)).toEqual(['build', 'review', 'verify'])
  })

  it('prefers the highest accept rate in the seat stage window', () => {
    const team = composeTeam({
      goal: '',
      members: [
        member('dev-low', 'developer', 'claude'),
        member('dev-high', 'developer', 'claude'),
        member('rev-1', 'reviewer', 'codex')
      ],
      trackRecords: [
        window_('dev-low', 'build', 0.5, 20),
        window_('dev-high', 'build', 0.95, 12),
        // A commanding record at the wrong stage must not carry a developer seat.
        window_('dev-low', 'review', 1, 40)
      ]
    })

    expect(seatOf(team, 'developer').memberId).toBe('dev-high')
    expect(seatOf(team, 'developer').acceptRate).toBe(0.95)
    expect(seatOf(team, 'developer').why).toBe(
      'Best of 2 developer candidates: 95% accepted over 12 run(s) at "build".'
    )
  })

  it('treats a zero-run window as unmeasured rather than as a zero accept rate', () => {
    const team = composeTeam({
      goal: '',
      members: [
        member('dev-zero', 'developer', 'claude'),
        member('dev-bad', 'developer', 'claude')
      ],
      trackRecords: [window_('dev-zero', 'build', 0, 0), window_('dev-bad', 'build', 0.1, 30)]
    })

    expect(seatOf(team, 'developer').memberId).toBe('dev-bad')
    expect(seatOf(team, 'developer').runs).toBe(30)
  })

  it('reports a zero-run seat as unmeasured rather than as 0% accepted', () => {
    const team = composeTeam({
      goal: '',
      members: [member('dev-zero', 'developer', 'claude')],
      trackRecords: [window_('dev-zero', 'build', 0, 0)]
    })

    expect(seatOf(team, 'developer').acceptRate).toBeNull()
    expect(seatOf(team, 'developer').why).toContain('No measured runs')
  })

  it('ranks unmeasured members below measured ones and breaks ties on id', () => {
    const team = composeTeam({
      goal: '',
      members: [member('dev-b', 'developer', 'claude'), member('dev-a', 'developer', 'claude')],
      trackRecords: []
    })

    expect(seatOf(team, 'developer').memberId).toBe('dev-a')
    expect(seatOf(team, 'developer').why).toContain('No measured runs at "build" yet')
  })

  it('keeps the reviewer off the developer backend', () => {
    const team = composeTeam({
      goal: '',
      members: [
        member('dev-1', 'developer', 'claude'),
        // The better record is on the author's backend, so it must lose the seat anyway.
        member('rev-same', 'reviewer', 'claude'),
        member('rev-other', 'reviewer', 'codex')
      ],
      trackRecords: [
        window_('rev-same', 'review', 0.99, 50),
        window_('rev-other', 'review', 0.6, 5)
      ]
    })

    expect(seatOf(team, 'reviewer').memberId).toBe('rev-other')
    expect(seatOf(team, 'reviewer').backend).toBe('codex')
    expect(seatOf(team, 'reviewer').why).toContain("Not on the developer's backend (claude)")
  })

  it('leaves the reviewer seat empty rather than seating one on the author backend', () => {
    const team = composeTeam({
      goal: '',
      members: [
        member('dev-1', 'developer', 'claude'),
        member('rev-same', 'reviewer', 'claude'),
        member('qa-1', 'qa', 'grok')
      ],
      trackRecords: []
    })

    expect(seatOf(team, 'reviewer').memberId).toBeNull()
    expect(team.gaps).toEqual([seatOf(team, 'reviewer').why])
    expect(team.gaps[0]).toContain('--allow-same-backend-review')
  })

  it('reports a missing role as a gap on the seat and on the team', () => {
    const team = composeTeam({
      goal: '',
      members: [member('dev-1', 'developer', 'claude'), member('rev-1', 'reviewer', 'codex')],
      trackRecords: []
    })

    expect(seatOf(team, 'qa').memberId).toBeNull()
    expect(seatOf(team, 'qa').why).toContain('No qa member exists')
    expect(team.gaps).toEqual([seatOf(team, 'qa').why])
  })

  it('allows any reviewer backend when no developer was seated', () => {
    const team = composeTeam({
      goal: '',
      members: [member('rev-1', 'reviewer', 'claude')],
      trackRecords: []
    })

    expect(seatOf(team, 'reviewer').memberId).toBe('rev-1')
  })
})

describe('renderTeamGateQuestion', () => {
  it('puts the roster, the evidence and the gaps in the question the human is asked', () => {
    const team = composeTeam({
      goal: 'Ship AT1',
      members: [
        member('dev-1', 'developer', 'claude', 'Ada'),
        member('rev-1', 'reviewer', 'claude')
      ],
      trackRecords: [window_('dev-1', 'build', 0.9, 10)]
    })
    const question = renderTeamGateQuestion(team)

    expect(question.startsWith('Run with this team?')).toBe(true)
    expect(question).toContain('Goal: Ship AT1')
    expect(question).toContain('developer @ build: Ada (claude, dev-1)')
    expect(question).toContain('90% accepted over 10 run(s)')
    expect(question).toContain('reviewer @ review: — unfilled')
    expect(question).toContain('Accepting leaves these open:')
  })
})

describe('isTeamAccepted', () => {
  it('accepts only the exact accept option', () => {
    expect(isTeamAccepted('accept')).toBe(true)
    expect(isTeamAccepted('  Accept ')).toBe(true)
    expect(isTeamAccepted('reject')).toBe(false)
    expect(isTeamAccepted('yes but swap the reviewer')).toBe(false)
    expect(isTeamAccepted(null)).toBe(false)
  })
})
