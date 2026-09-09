import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import { journalPath, readJournal } from '../../../alicorn/foreman/journal'
import type { RpcContext } from '../core'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { Member, MemberBackend, MemberRole } from '../../../../shared/alicorn/members'
import type { DecisionGateRow } from '../../orchestration/types'

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

function directory(members: Member[]): MemberDirectory {
  return {
    getMember: vi.fn().mockResolvedValue(null),
    listMembers: vi.fn().mockResolvedValue(members),
    getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: true }),
    getSeatConnectors: vi.fn().mockResolvedValue({ seat: null, connectors: [] }),
    getRequiredChecks: vi.fn().mockResolvedValue([]),
    getProtectedPaths: vi.fn().mockResolvedValue([]),
    getAutonomyPolicy: vi.fn().mockResolvedValue(null),
    getStageConfig: vi.fn().mockResolvedValue({ reversibility: 'contained', inheritedCost: 'low' }),
    listAutonomyPolicies: vi.fn().mockResolvedValue([]),
    setAutonomyPolicy: vi.fn(),
    getTrackRecord: vi.fn().mockRejectedValue(new Error('no ledger in this fixture'))
  }
}

type ProposeResult = {
  gate: DecisionGateRow
  team: { seats: { role: string; memberId: string | null }[]; gaps: string[] }
  journalled: boolean
}

describe('orchestration.teamPropose (AT1)', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  let activeRunId: string | undefined
  let worktree = ''

  afterEach(() => {
    h.cleanup()
    if (worktree) {
      rmSync(worktree, { recursive: true, force: true })
      worktree = ''
    }
  })

  function setup(members: Member[]): string {
    ;({ db, runtime, ctx, activeRunId } = h.setup())
    runtime.setAlicornMemberDirectory(directory(members))
    worktree = mkdtempSync(join(tmpdir(), 'at1-rpc-'))
    vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({
      id: 'worktree-1',
      path: worktree,
      repoId: 'repo-1'
    } as Awaited<ReturnType<OrcaRuntimeService['showManagedWorktree']>>)
    return db.createTask({ spec: 'ship partial refunds' }).id
  }

  const propose = (task: string) =>
    h.call(
      'orchestration.teamPropose',
      { task, worktree: 'id:worktree-1' },
      ctx
    ) as Promise<ProposeResult>

  it('opens a gate that asks a human about the roster, and blocks the task on it', async () => {
    const task = setup([
      member('dev-1', 'developer', 'claude'),
      member('rev-1', 'reviewer', 'codex'),
      member('qa-1', 'qa', 'grok')
    ])

    const result = await propose(task)

    expect(result.gate.status).toBe('pending')
    expect(result.gate.question).toContain('Run with this team?')
    expect(result.gate.question).toContain('developer @ build: dev-1')
    expect(JSON.parse(result.gate.options)).toEqual(['accept', 'reject'])
    expect(result.team.seats.map((seat) => seat.memberId)).toEqual(['dev-1', 'rev-1', 'qa-1'])
    expect(db.getTask(task)?.status).toBe('blocked')
  })

  it('records the roster in the Feature Journal against the gate it opened', async () => {
    const task = setup([member('dev-1', 'developer', 'claude')])

    const result = await propose(task)

    expect(result.journalled).toBe(true)
    const journal = await readJournal(journalPath(worktree, activeRunId!))
    expect(journal?.team?.gateId).toBe(result.gate.id)
    expect(journal?.team?.seats.map((seat) => seat.memberId)).toEqual(['dev-1', null, null])
  })

  it('never proposes a reviewer on the developer backend, and says why', async () => {
    const task = setup([
      member('dev-1', 'developer', 'claude'),
      member('rev-same', 'reviewer', 'claude')
    ])

    const result = await propose(task)

    expect(result.team.seats.find((seat) => seat.role === 'reviewer')?.memberId).toBeNull()
    expect(result.gate.question).toContain('--allow-same-backend-review')
  })

  it('refuses when there is no control plane to read members from', async () => {
    const task = setup([])
    runtime.setAlicornMemberDirectory(null)

    await expect(propose(task)).rejects.toThrow(/no control plane is configured/)
  })
})
