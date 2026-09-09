import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import { runContractAcknowledgedCheck } from '../../../alicorn/contracts/contract-acknowledged-check'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { Member } from '../../../../shared/alicorn/members'

const MEMBER: Member = {
  id: 'm1',
  tenantId: 'local',
  createdBy: 'actor',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  name: 'Lead',
  role: 'developer',
  backend: 'claude',
  workspaceKind: 'worktree',
  permissionMode: 'ask',
  systemRules: '',
  skills: []
}

function directory(): MemberDirectory {
  return {
    getMember: vi.fn().mockResolvedValue(MEMBER),
    listMembers: vi.fn().mockResolvedValue([]),
    getSeatConnectors: vi.fn().mockResolvedValue({ seat: null, connectors: [] }),
    getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: true }),
    getRequiredChecks: vi.fn().mockResolvedValue([]),
    getProtectedPaths: vi.fn().mockResolvedValue([]),
    getAutonomyPolicy: vi.fn().mockResolvedValue(null),
    getStageConfig: vi.fn().mockResolvedValue({ reversibility: 'contained', inheritedCost: 'low' }),
    listAutonomyPolicies: vi.fn().mockResolvedValue([]),
    setAutonomyPolicy: vi.fn(),
    getTrackRecord: vi.fn().mockRejectedValue(new Error('no track record'))
  }
}

/**
 * FJ1 — the Feature Journal has to be reachable from a dispatch a running app actually makes.
 *
 * The only `new Coordinator(...)` outside tests is inside `orchestration.run`, which the contract
 * fence refuses as `command_retired`, so a test that hands a `Coordinator` a `worktreePath` proves
 * nothing about production. These go through the real `orchestration.workerStart` handler.
 */
describe('worker-start opens the run journal for a lead', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  let worktreePath = ''

  afterEach(() => {
    h.cleanup()
    if (worktreePath) {
      rmSync(worktreePath, { recursive: true, force: true })
      worktreePath = ''
    }
  })

  function setup(hostId?: string): void {
    worktreePath = mkdtempSync(join(tmpdir(), 'fj1-lead-'))
    mkdirSync(join(worktreePath, 'contracts'))
    writeFileSync(
      join(worktreePath, 'contracts', 'api.ts'),
      'export type Booking = { id: string; seats: number }\n',
      'utf8'
    )
    ;({ db, runtime, ctx } = h.setup())
    vi.spyOn(runtime, 'getAlicornMemberDirectory').mockReturnValue(directory())
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showTerminal').mockImplementation(
      async (handle) => ({ handle, worktreeId: 'repo::worktree', status: 'running' }) as never
    )
    vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({ id: 'repo::worktree' } as never)
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'repo::worktree',
      path: worktreePath,
      ...(hostId ? { hostId } : {})
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

  async function start(params: Record<string, unknown> = {}): Promise<string> {
    const task = db.createTask({ spec: 'decompose the ticket' })
    const result = (await h.call(
      'orchestration.workerStart',
      {
        task: task.id,
        from: 'term_coord',
        member: 'm1',
        role: 'lead',
        worktree: 'id:repo::worktree',
        ...params
      },
      ctx
    )) as { runId: string }
    return result.runId
  }

  function journal(runId: string): string {
    return join(worktreePath, '.foreman', runId, 'journal.md')
  }

  it('writes the journal the lead is briefed to work from, with the registry filled', async () => {
    setup()

    const runId = await start()

    expect(existsSync(journal(runId))).toBe(true)
    const markdown = readFileSync(journal(runId), 'utf8')
    expect(markdown).toContain('Booking')
    expect(markdown).toContain('contracts/api.ts')
  })

  // The reason this ticket exists: CR2 reads the registry off this file, and an absent one passes.
  it('gives CR2 a registry to read, where it had none', async () => {
    setup()
    const listAcknowledgedNames = async (): Promise<string[]> => []

    const before = await runContractAcknowledgedCheck({
      worktreePath,
      runId: 'run_never_started',
      projectId: 'p1',
      listAcknowledgedNames
    })
    const runId = await start()
    const after = await runContractAcknowledgedCheck({
      worktreePath,
      runId,
      projectId: 'p1',
      listAcknowledgedNames
    })

    expect(before.detail).toEqual({ reason: 'no_contract_registry' })
    expect(after.detail).not.toEqual({ reason: 'no_contract_registry' })
  })

  // `single` is the default and must stay free: an ordinary worker start writes nothing to disk.
  it('writes nothing for an ordinary worker dispatch', async () => {
    setup()

    const runId = await start({ role: undefined })

    expect(existsSync(join(worktreePath, '.foreman'))).toBe(false)
    expect(existsSync(journal(runId))).toBe(false)
  })

  // `path` belongs to the execution host: writing it here would journal onto the client's disk
  // while the lead reads the host's.
  it('refuses an SSH-hosted worktree rather than writing a local look-alike', async () => {
    setup('ssh:host_1')

    const runId = await start()

    expect(existsSync(join(worktreePath, '.foreman'))).toBe(false)
    expect(existsSync(journal(runId))).toBe(false)
  })
})
