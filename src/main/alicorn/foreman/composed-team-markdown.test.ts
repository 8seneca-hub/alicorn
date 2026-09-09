import { describe, expect, it } from 'vitest'
import { parseJournalTeam, renderJournalTeam } from './composed-team-markdown'
import type { JournalTeam } from './team-composer'

const team: JournalTeam = {
  gateId: 'gate_1',
  goal: 'Ship partial refunds | end to end',
  seats: [
    {
      role: 'developer',
      stageKey: 'build',
      memberId: 'mem_dev',
      memberName: 'Ada',
      backend: 'claude',
      acceptRate: 0.92,
      runs: 24,
      why: 'Best of 3 developers.'
    },
    {
      role: 'reviewer',
      stageKey: 'review',
      memberId: null,
      memberName: null,
      backend: null,
      acceptRate: null,
      runs: null,
      why: 'Every reviewer runs on claude.'
    }
  ],
  gaps: ['Every reviewer runs on claude.']
}

describe('the journal Team section', () => {
  it('round-trips a composed team, escaped cells included', () => {
    expect(parseJournalTeam(renderJournalTeam(team))).toEqual(team)
  })

  it('reads an absent, empty or placeholder section as no team', () => {
    expect(parseJournalTeam(null)).toBeNull()
    expect(parseJournalTeam('')).toBeNull()
    expect(parseJournalTeam(renderJournalTeam(null))).toBeNull()
  })

  // A section a lead typed over without a gate id names no gate to resolve, so there is nothing to
  // approve — reading it as "no team" is safer than inventing one nobody was asked about.
  it('reads a section with no gate as no team', () => {
    expect(parseJournalTeam('**Goal:** something\n\n| Seat |\n|---|\n')).toBeNull()
  })

  it('rejects a seat the composer could never have produced', () => {
    const rendered = renderJournalTeam(team).replace('| developer |', '| architect |')
    expect(() => parseJournalTeam(rendered)).toThrow(/unknown seat "architect"/)
  })
})
