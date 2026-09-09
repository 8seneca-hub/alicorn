import {
  TEAM_SEAT_ROLES,
  type JournalTeam,
  type TeamSeat,
  type TeamSeatRole
} from './team-composer'
import { cell, renderTable, tableRows, uncell } from './markdown-table'
import { JournalParseError } from './journal-types'

// The journal's `## Team` section (AT1) — see `JournalTeam` for why no verdict is stored here.

const SECTION = 'Team'

// Whole percent, so a rate does not survive a round trip to the last decimal. That is deliberate:
// the ranking already happened, and what is left is a number a human reads at a gate.
function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

function unpercent(value: string): number | null {
  const raw = uncell(value)
  if (!raw) {
    return null
  }
  const parsed = Number(raw.replace(/%$/, ''))
  if (!Number.isFinite(parsed)) {
    throw new JournalParseError(SECTION, `expected an accept rate, got "${raw}"`)
  }
  return parsed / 100
}

function unnumber(value: string): number | null {
  const raw = uncell(value)
  if (!raw) {
    return null
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    throw new JournalParseError(SECTION, `expected a run count, got "${raw}"`)
  }
  return parsed
}

function requireSeatRole(value: string): TeamSeatRole {
  const found = TEAM_SEAT_ROLES.find((role) => role === value)
  if (!found) {
    throw new JournalParseError(SECTION, `unknown seat "${value}"`)
  }
  return found
}

export function renderJournalTeam(team: JournalTeam | null): string {
  if (!team) {
    return '—'
  }
  return [
    `**Gate:** ${team.gateId}`,
    `**Goal:** ${cell(team.goal)}`,
    '',
    renderTable(
      ['Seat', 'Stage', 'Member', 'Id', 'Backend', 'Accepted', 'Runs', 'Why'],
      team.seats.map((seat) => [
        seat.role,
        cell(seat.stageKey),
        seat.memberName === null ? '—' : cell(seat.memberName),
        seat.memberId === null ? '—' : cell(seat.memberId),
        seat.backend === null ? '—' : seat.backend,
        percent(seat.acceptRate),
        seat.runs === null ? '—' : String(seat.runs),
        cell(seat.why)
      ])
    ),
    '',
    ...(team.gaps.length > 0 ? team.gaps.map((gap) => `- ${gap}`) : ['- —'])
  ].join('\n')
}

/**
 * Absent, `—`, or gate-less reads as "no team was composed" rather than as a parse error: every
 * journal written before AT1 has no such section, and a run without a composed team is the normal
 * case, not a broken one.
 */
export function parseJournalTeam(body: string | null): JournalTeam | null {
  if (body === null || body.trim() === '' || body.trim() === '—') {
    return null
  }
  const gateId = /\*\*Gate:\*\*\s*(\S+)/.exec(body)?.[1]
  if (!gateId) {
    return null
  }
  const goal = /\*\*Goal:\*\*\s*([^\n]*)/.exec(body)?.[1] ?? ''
  const seats: TeamSeat[] = tableRows(body, SECTION).map((row) => ({
    role: requireSeatRole(uncell(row[0] ?? '')),
    stageKey: uncell(row[1] ?? ''),
    memberName: uncell(row[2] ?? '') || null,
    memberId: uncell(row[3] ?? '') || null,
    backend: (uncell(row[4] ?? '') || null) as TeamSeat['backend'],
    acceptRate: unpercent(row[5] ?? ''),
    runs: unnumber(row[6] ?? ''),
    why: uncell(row[7] ?? '')
  }))
  const gaps = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((gap) => gap !== '' && gap !== '—')
  return { gateId, goal: uncell(goal), seats, gaps }
}
