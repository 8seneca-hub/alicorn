import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { prepareMemberAwareWorkerStart } from './orchestration-member-worker-start'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { Member, MemberBackend } from '../../../../shared/alicorn/members'
import type { WorkerStartInput } from './orchestration-worker-start-schema'

function member(backend: MemberBackend): Member {
  return {
    id: 'm1',
    tenantId: 'local',
    createdBy: 'actor',
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    name: 'Lead',
    // A lead is a dispatch role, not a member role: any member can be dispatched to lead.
    role: 'developer',
    backend,
    workspaceKind: 'worktree',
    permissionMode: 'ask',
    systemRules: '',
    skills: []
  }
}

function directory(found: Member): MemberDirectory {
  return {
    getMember: vi.fn().mockResolvedValue(found),
    getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: true }),
    getRequiredChecks: vi.fn().mockResolvedValue([]),
    getAutonomyPolicy: vi.fn().mockResolvedValue(null),
    getStageConfig: vi.fn().mockResolvedValue({ reversibility: 'contained', inheritedCost: 'low' }),
    listAutonomyPolicies: vi.fn().mockResolvedValue([]),
    setAutonomyPolicy: vi.fn(),
    getTrackRecord: vi.fn().mockRejectedValue(new Error('no track record'))
  }
}

function runtimeFor(found: Member): OrcaRuntimeService {
  return {
    getAlicornMemberDirectory: () => directory(found),
    validateOrchestrationAgentLauncher: vi.fn()
  } as unknown as OrcaRuntimeService
}

function params(overrides: Partial<WorkerStartInput> = {}): WorkerStartInput {
  return { task: 't1', from: 'terminal-1', member: 'm1', role: 'lead', ...overrides }
}

describe('prepareMemberAwareWorkerStart', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('carries the lead restrictions the launch path applies', async () => {
    const prepared = await prepareMemberAwareWorkerStart({
      params: params(),
      createsWorktree: false,
      runtime: runtimeFor(member('claude')),
      db,
      taskId: 't1'
    })

    expect(prepared.leadLaunch?.disallowedTools).toContain('Write')
    expect(prepared.leadLaunch?.env.ALICORN_ROLE).toBe('lead')
  })

  it('leaves an ordinary worker dispatch unrestricted', async () => {
    const prepared = await prepareMemberAwareWorkerStart({
      params: params({ role: undefined }),
      createsWorktree: false,
      runtime: runtimeFor(member('claude')),
      db,
      taskId: 't1'
    })

    expect(prepared.leadLaunch).toBeNull()
  })

  // A lead writes no code, so a worktree of its own would have nothing in it to write to.
  it('refuses a lead that creates a worktree', async () => {
    await expect(
      prepareMemberAwareWorkerStart({
        params: params({ worktree: 'new-child', name: 'lead' }),
        createsWorktree: true,
        runtime: runtimeFor(member('claude')),
        db,
        taskId: 't1'
      })
    ).rejects.toMatchObject({ code: 'lead_worktree_unsupported' })
  })

  // Why: an already-running agent cannot be restricted after the fact, and reusing one would give
  // a lead that writes code while the run still reports itself as orchestrated.
  it('refuses a lead that reuses a running agent terminal', async () => {
    await expect(
      prepareMemberAwareWorkerStart({
        params: params({ terminal: 'terminal-9' }),
        createsWorktree: false,
        runtime: runtimeFor(member('claude')),
        db,
        taskId: 't1'
      })
    ).rejects.toMatchObject({ code: 'lead_terminal_reuse_unsupported' })
  })

  it('refuses a backend that cannot restrict its tools before any effect', async () => {
    await expect(
      prepareMemberAwareWorkerStart({
        params: params(),
        createsWorktree: false,
        runtime: runtimeFor(member('codex')),
        db,
        taskId: 't1'
      })
    ).rejects.toBeInstanceOf(OrchestrationError)
  })
})
