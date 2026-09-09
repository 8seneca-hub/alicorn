import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { journalComposedTeam, readApprovedTeam } from './composed-team-record'
import { journalPath, readJournal } from './journal'
import type { ComposedTeam } from './team-composer'
import type { DecisionGateRow } from '../../runtime/orchestration/types'

let worktree = ''

const TEAM: ComposedTeam = {
  goal: 'Ship partial refunds',
  seats: [
    {
      role: 'developer',
      stageKey: 'build',
      memberId: 'mem_dev',
      memberName: 'Ada',
      backend: 'claude',
      acceptRate: 0.9,
      runs: 10,
      why: 'Best of 2 developers.'
    }
  ],
  gaps: []
}

function gate(overrides: Partial<DecisionGateRow> = {}): DecisionGateRow {
  return {
    id: 'gate_1',
    run_id: 'run_1',
    task_id: 'task_1',
    question: 'Run with this team?',
    options: '["accept","reject"]',
    status: 'resolved',
    resolution: 'accept',
    created_at: '',
    resolved_at: '',
    recommended_decision: null,
    recommended_reason: null,
    recommended_level: null,
    stage_key: null,
    retired_at: null,
    retirement_refusal: null,
    ...overrides
  }
}

function makeWorktree(): string {
  worktree = mkdtempSync(join(tmpdir(), 'at1-'))
  return worktree
}

afterEach(() => {
  if (worktree) {
    rmSync(worktree, { recursive: true, force: true })
    worktree = ''
  }
})

describe('journalComposedTeam', () => {
  it('creates the journal if the run has none and records the roster against the gate', async () => {
    const path = makeWorktree()
    expect(
      await journalComposedTeam({
        worktree: { path },
        runId: 'run_1',
        objective: 'Ship partial refunds',
        team: TEAM,
        gateId: 'gate_1'
      })
    ).toBe(true)

    const journal = await readJournal(journalPath(path, 'run_1'))
    expect(journal?.team).toEqual({ ...TEAM, gateId: 'gate_1' })
    expect(journal?.log.at(-1)?.line).toContain('team proposed at gate gate_1: 1/1 seats filled')
  })

  it('replaces an earlier proposal instead of leaving the lead two rosters', async () => {
    const path = makeWorktree()
    const base = { worktree: { path }, runId: 'run_1', objective: 'o', team: TEAM }
    await journalComposedTeam({ ...base, gateId: 'gate_1' })
    await journalComposedTeam({ ...base, gateId: 'gate_2' })

    expect((await readJournal(journalPath(path, 'run_1')))?.team?.gateId).toBe('gate_2')
  })

  // `path` belongs to the execution host: writing it here would put the journal on the client's
  // disk while the lead reads the host's.
  it('refuses a worktree on another execution host', async () => {
    const path = makeWorktree()
    expect(
      await journalComposedTeam({
        worktree: { path, hostId: 'ssh:build-box' },
        runId: 'run_1',
        objective: 'o',
        team: TEAM,
        gateId: 'gate_1'
      })
    ).toBe(false)
    expect(await readJournal(journalPath(path, 'run_1'))).toBeNull()
  })

  it('reports rather than throws when there is no worktree to write to', async () => {
    expect(
      await journalComposedTeam({
        worktree: null,
        runId: 'run_1',
        objective: 'o',
        team: TEAM,
        gateId: 'gate_1'
      })
    ).toBe(false)
  })
})

describe('readApprovedTeam', () => {
  async function withJournalledTeam(): Promise<string> {
    const path = makeWorktree()
    await journalComposedTeam({
      worktree: { path },
      runId: 'run_1',
      objective: 'o',
      team: TEAM,
      gateId: 'gate_1'
    })
    return path
  }

  it('returns the roster when the gate the journal names was accepted', async () => {
    const path = await withJournalledTeam()
    expect(
      await readApprovedTeam({ worktreePath: path, runId: 'run_1', getGate: () => gate() })
    ).toEqual(TEAM)
  })

  it('returns nothing while the gate is still pending', async () => {
    const path = await withJournalledTeam()
    expect(
      await readApprovedTeam({
        worktreePath: path,
        runId: 'run_1',
        getGate: () => gate({ status: 'pending', resolution: null })
      })
    ).toBeNull()
  })

  // A resolution the human typed is a conversation, not the accept option.
  it('returns nothing for a resolution that is not the accept option', async () => {
    const path = await withJournalledTeam()
    expect(
      await readApprovedTeam({
        worktreePath: path,
        runId: 'run_1',
        getGate: () => gate({ resolution: 'yes, but swap the reviewer' })
      })
    ).toBeNull()
  })

  // A composed team is approved by a human or not at all: an autonomy policy must never be able to
  // wave one through, whatever track record the members have.
  it('returns nothing for a gate the policy retired rather than a human resolving', async () => {
    const path = await withJournalledTeam()
    expect(
      await readApprovedTeam({
        worktreePath: path,
        runId: 'run_1',
        getGate: () => gate({ resolution: 'accept', retired_at: '2026-09-09T00:00:00.000Z' })
      })
    ).toBeNull()
  })

  it('returns nothing when the journal names a gate that no longer exists', async () => {
    const path = await withJournalledTeam()
    expect(
      await readApprovedTeam({ worktreePath: path, runId: 'run_1', getGate: () => undefined })
    ).toBeNull()
  })

  it('returns nothing when the run has no journal at all', async () => {
    expect(
      await readApprovedTeam({
        worktreePath: makeWorktree(),
        runId: 'run_1',
        getGate: () => gate()
      })
    ).toBeNull()
  })
})
