import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { Member, MemberBackend } from '../../../../shared/alicorn/members'

function lead(backend: MemberBackend): Member {
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

describe('worker-start lead restrictions', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext

  afterEach(() => {
    h.cleanup()
  })

  function directory(
    member: Member,
    listMembers: MemberDirectory['listMembers'] = vi.fn().mockResolvedValue([])
  ): MemberDirectory {
    return {
      getMember: vi.fn().mockResolvedValue(member),
      listMembers,
      getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: true }),
      getSeatConnectors: vi.fn().mockResolvedValue({ seat: null, connectors: [] }),
      getRequiredChecks: vi.fn().mockResolvedValue([]),
      getProtectedPaths: vi.fn().mockResolvedValue([]),
      getAutonomyPolicy: vi.fn().mockResolvedValue(null),
      getStageConfig: vi
        .fn()
        .mockResolvedValue({ reversibility: 'contained', inheritedCost: 'low' }),
      listAutonomyPolicies: vi.fn().mockResolvedValue([]),
      setAutonomyPolicy: vi.fn(),
      getTrackRecord: vi.fn().mockRejectedValue(new Error('no track record'))
    }
  }

  function setup(member: Member, listMembers?: MemberDirectory['listMembers']): void {
    ;({ db, runtime, ctx } = h.setup())
    vi.spyOn(runtime, 'getAlicornMemberDirectory').mockReturnValue(
      listMembers ? directory(member, listMembers) : directory(member)
    )
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showTerminal').mockImplementation(
      async (handle) => ({ handle, worktreeId: 'repo::worktree', status: 'running' }) as never
    )
    vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({ id: 'repo::worktree' } as never)
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'repo::worktree'
    } as never)
    vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
      handle: 'term_worker',
      worktreeId: 'repo::worktree',
      title: 'lead'
    })
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'term_worker',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    vi.mocked(runtime.getTerminalProcessIncarnation).mockImplementation((handle) =>
      handle === 'term_worker' ? 'runtime_test:term_worker:1' : 'runtime_test:term_coord:1'
    )
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    // Without a stable pane for the worker the start fails at readiness, before the preamble is
    // ever built; the coordinator's own key is left as the harness set it.
    const harnessPaneKey = vi.mocked(runtime.getTerminalPaneKey).getMockImplementation()!
    vi.mocked(runtime.getTerminalPaneKey).mockImplementation(
      (handle) => harnessPaneKey(handle) ?? `pane:${handle}`
    )
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'term_worker',
      accepted: true,
      bytesWritten: 1
    })
  }

  async function startLead(params: Record<string, unknown> = {}) {
    const task = db.createTask({ spec: 'decompose the ticket' })
    return h.call(
      'orchestration.workerStart',
      { task: task.id, from: 'term_coord', member: 'm1', role: 'lead', ...params },
      ctx
    )
  }

  it('launches the lead terminal with the restrictions it cannot be given later', async () => {
    setup(lead('claude'))

    await startLead()

    expect(runtime.createTerminal).toHaveBeenCalledWith(
      'id:repo::worktree',
      expect.objectContaining({
        startupAgent: 'claude',
        launchRestrictions: {
          disallowedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
          env: { ALICORN_ROLE: 'lead' }
        }
      })
    )
  })

  it('leaves an ordinary worker dispatch unrestricted', async () => {
    setup(lead('claude'))

    await startLead({ role: undefined })

    expect(runtime.createTerminal).toHaveBeenCalledWith(
      'id:repo::worktree',
      expect.not.objectContaining({ launchRestrictions: expect.anything() })
    )
  })

  // RB2 — the learning edge reaching the splitter. The lead is the one agent that decides who does
  // what, so a rule it never reads is a decomposition mistake waiting to repeat.
  describe('what the lead is briefed with', () => {
    function prompt(): string {
      return vi.mocked(runtime.sendTerminalAgentPrompt).mock.calls[0]![1] as string
    }

    it('carries the journal instructions and the rules of the members it may dispatch', async () => {
      setup(
        lead('claude'),
        vi.fn().mockResolvedValue([
          { ...lead('claude'), name: 'Ana', systemRules: 'Migrate before retyping a column.' },
          { ...lead('claude'), name: 'Bo', systemRules: '' }
        ])
      )

      await startLead()

      expect(prompt()).toContain('=== JOURNAL ===')
      expect(prompt()).toContain('=== TEAM RULES ===')
      expect(prompt()).toContain('## Ana')
      expect(prompt()).toContain('Migrate before retyping a column.')
      expect(prompt()).not.toContain('## Bo')
    })

    // Foreman is an add-on: an ordinary dispatch gains none of this.
    it('adds neither to an ordinary worker dispatch', async () => {
      setup(
        lead('claude'),
        vi
          .fn()
          .mockResolvedValue([{ ...lead('claude'), name: 'Ana', systemRules: 'Migrate first.' }])
      )

      await startLead({ role: undefined })

      expect(prompt()).not.toContain('=== JOURNAL ===')
      expect(prompt()).not.toContain('=== TEAM RULES ===')
    })

    // The lead's own member was read before any terminal existed; past that point an unreachable
    // control plane costs the lead its team rules, never its dispatch.
    it('still dispatches when the members cannot be read', async () => {
      setup(lead('claude'), vi.fn().mockRejectedValue(new Error('control plane down')))
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      await startLead()

      expect(prompt()).toContain('=== JOURNAL ===')
      expect(prompt()).not.toContain('=== TEAM RULES ===')
    })
  })

  // Why refuse: a lead that can quietly write code makes a run look orchestrated while being
  // nothing of the sort, and nothing downstream would notice.
  it('refuses a backend that cannot restrict its tools, before any terminal exists', async () => {
    setup(lead('codex'))

    await expect(startLead()).rejects.toMatchObject({ code: 'lead_backend_unsupported' })
    expect(runtime.createTerminal).not.toHaveBeenCalled()
  })
})
