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

  function directory(member: Member): MemberDirectory {
    return {
      getMember: vi.fn().mockResolvedValue(member),
      getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: true }),
      getRequiredChecks: vi.fn().mockResolvedValue([])
    }
  }

  function setup(member: Member): void {
    ;({ db, runtime, ctx } = h.setup())
    vi.spyOn(runtime, 'getAlicornMemberDirectory').mockReturnValue(directory(member))
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

  // Why refuse: a lead that can quietly write code makes a run look orchestrated while being
  // nothing of the sort, and nothing downstream would notice.
  it('refuses a backend that cannot restrict its tools, before any terminal exists', async () => {
    setup(lead('codex'))

    await expect(startLead()).rejects.toMatchObject({ code: 'lead_backend_unsupported' })
    expect(runtime.createTerminal).not.toHaveBeenCalled()
  })
})
