import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { leadBriefPreambleFields } from './orchestration-worker-lead-brief'
import { journalComposedTeam } from '../../../alicorn/foreman/composed-team-record'
import type { ComposedTeam } from '../../../alicorn/foreman/team-composer'
import type { DecisionGateRow } from '../../orchestration/types'
import type { MemberDirectory } from '../../../alicorn/member-directory'

let worktree = ''

afterEach(() => {
  if (worktree) {
    rmSync(worktree, { recursive: true, force: true })
    worktree = ''
  }
})

const TEAM: ComposedTeam = {
  goal: 'Ship it',
  seats: [
    {
      role: 'developer',
      stageKey: 'build',
      memberId: 'mem_dev',
      memberName: 'Ada',
      backend: 'claude',
      acceptRate: null,
      runs: null,
      why: 'Only developer available.'
    }
  ],
  gaps: []
}

const ACCEPTED = { resolution: 'accept' } as DecisionGateRow

async function journalled(): Promise<string> {
  worktree = mkdtempSync(join(tmpdir(), 'at1-brief-'))
  await journalComposedTeam({
    worktree: { path: worktree },
    runId: 'run_1',
    objective: 'Ship it',
    team: TEAM,
    gateId: 'gate_1'
  })
  return worktree
}

// RB2's half of the lead brief: the standing rules of the members it may dispatch.
const RULES = [{ name: 'Ada', systemRules: 'Never rebase a shared branch.' }]
const runtime = {
  getAlicornMemberDirectory: () =>
    ({ listMembers: async () => RULES }) as unknown as MemberDirectory
}

describe('leadBriefPreambleFields', () => {
  // `single` stays the default: an ordinary worker start must not gain a disk read.
  it('gives an ordinary worker nothing, and reads no journal to decide that', async () => {
    const getGate = vi.fn()

    expect(
      await leadBriefPreambleFields({
        role: 'worker',
        runId: 'run_1',
        objective: 'ship the ticket',
        worktreePath: await journalled(),
        getGate,
        runtime
      })
    ).toEqual({})
    expect(getGate).not.toHaveBeenCalled()
  })

  it('brief a lead with the journal and the roster its gate approved', async () => {
    const fields = await leadBriefPreambleFields({
      role: 'lead',
      runId: 'run_1',
      objective: 'ship the ticket',
      worktreePath: await journalled(),
      getGate: () => ACCEPTED,
      runtime
    })

    expect(fields.foremanRole).toBe('lead')
    expect(fields.runId).toBe('run_1')
    expect(fields.approvedTeam).toEqual(TEAM)
    // The roster and the rules reach the lead together; AT1 and RB2 share this one seam.
    expect(fields.teamRules).toEqual(RULES)
  })

  it('still marks the dispatch a lead when nothing was approved', async () => {
    const fields = await leadBriefPreambleFields({
      role: 'lead',
      runId: 'run_1',
      objective: 'ship the ticket',
      worktreePath: await journalled(),
      getGate: () => ({ resolution: null }) as DecisionGateRow,
      runtime
    })

    expect(fields.foremanRole).toBe('lead')
    expect(fields.approvedTeam).toBeNull()
  })
})
