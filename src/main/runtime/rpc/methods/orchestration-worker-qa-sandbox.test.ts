import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { Member, MemberBackend, MemberRole } from '../../../../shared/alicorn/members'

function qaMember(backend: MemberBackend, role: MemberRole = 'qa'): Member {
  return {
    id: 'm1',
    tenantId: 'local',
    createdBy: 'actor',
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    name: 'QA',
    role,
    backend,
    workspaceKind: 'worktree',
    permissionMode: 'ask',
    systemRules: '',
    skills: []
  }
}

describe('worker-start QA sandbox', () => {
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
      getRequiredChecks: vi.fn().mockResolvedValue([]),
      getAutonomyPolicy: vi.fn().mockResolvedValue(null),
      getStageConfig: vi
        .fn()
        .mockResolvedValue({ reversibility: 'contained', inheritedCost: 'low' }),
      // GP2's policy surface; unused here, but MemberDirectory is a whole-interface stub.
      listAutonomyPolicies: vi.fn().mockResolvedValue([]),
      setAutonomyPolicy: vi.fn().mockResolvedValue(null),
      getTrackRecord: vi.fn().mockResolvedValue(null)
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
      title: 'qa'
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

  async function startQa(params: Record<string, unknown> = {}) {
    const task = db.createTask({ spec: 'test the checkout flow' })
    return h.call(
      'orchestration.workerStart',
      { task: task.id, from: 'term_coord', member: 'm1', ...params },
      ctx
    )
  }

  // The whole control depends on this env reaching the pane: without it the `PreToolUse` hook
  // answers neutrally and QA reads whatever it likes.
  it('launches a QA pane with the role its tool gate keys on', async () => {
    setup(qaMember('claude'))

    await startQa()

    expect(runtime.createTerminal).toHaveBeenCalledWith(
      'id:repo::worktree',
      expect.objectContaining({
        startupAgent: 'claude',
        launchRestrictions: { env: { ALICORN_ROLE: 'qa' } }
      })
    )
  })

  it('leaves a developer member unrestricted', async () => {
    setup(qaMember('claude', 'developer'))

    await startQa()

    expect(runtime.createTerminal).toHaveBeenCalledWith(
      'id:repo::worktree',
      expect.not.objectContaining({ launchRestrictions: expect.anything() })
    )
  })

  it('refuses a QA member on a backend with no tool gate, before any terminal exists', async () => {
    setup(qaMember('codex'))

    await expect(startQa()).rejects.toMatchObject({ code: 'qa_backend_unsupported' })
    expect(runtime.createTerminal).not.toHaveBeenCalled()
  })
})
