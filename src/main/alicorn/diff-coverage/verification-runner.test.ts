import { describe, expect, it, vi } from 'vitest'
import { createVerificationRunner } from './verification-runner'
import type { LedgerWriter } from '../ledger/ledger-writer'
import type { DiffCoverageCheck } from '../../../shared/alicorn/members'

const CHECK: DiffCoverageCheck = {
  kind: 'diff_coverage',
  threshold: 0.8,
  lcovPath: 'coverage/lcov.info',
  timeoutMs: 30_000
}

const PAYLOAD = {
  dispatchId: 'ctx_1',
  taskId: 'task_1',
  runId: 'run_1',
  worktreeId: 'wt_1',
  worktreePath: '/repo',
  branch: 'feature',
  projectId: 'proj_1'
}

function makeWriter(): LedgerWriter {
  return {
    postStepOutcome: vi.fn(),
    patchStepOutcomeSpend: vi.fn(),
    postStepVerification: vi.fn().mockResolvedValue({ id: 'sv_1', duplicate: false }),
    postContextCapture: vi.fn()
  } as unknown as LedgerWriter
}

const RESOLVE_ORIGIN_MAIN = async () => ({ baseRef: 'origin/main', gitOptions: {} })

const NO_CONTRACT_CHECK = async (): Promise<{
  status: 'passed'
  detail: Record<string, unknown>
}> => ({ status: 'passed', detail: {} })

const NO_INTEGRATION_CHECK = async (): Promise<{
  status: 'passed'
  detail: Record<string, unknown>
}> => ({ status: 'passed', detail: {} })

const NO_SKILLS = async (): Promise<{
  resolved: never[]
  catalogNameById: Map<string, string>
}> => ({ resolved: [], catalogNameById: new Map() })

describe('createVerificationRunner', () => {
  it('resolves without posting when no diff_coverage check is configured', async () => {
    const writer = makeWriter()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [],
      runDiffCoverageCheck: vi.fn(),
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveSkillsForDispatch: NO_SKILLS,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'local'
    })

    await runner(PAYLOAD, writer)

    expect(writer.postStepVerification).not.toHaveBeenCalled()
  })

  it('skips a folder workspace with no .git directory', async () => {
    const writer = makeWriter()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: vi.fn(),
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveSkillsForDispatch: NO_SKILLS,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'local',
      pathExists: async () => false
    })

    await runner(PAYLOAD, writer)

    expect(writer.postStepVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'diff_coverage',
        name: 'Diff coverage ≥ 80%',
        required: true,
        status: 'skipped',
        detail: { reason: 'not_a_git_worktree' }
      })
    )
  })

  it('skips an SSH-hosted (remote) worktree without touching the local filesystem', async () => {
    const writer = makeWriter()
    const runCheck = vi.fn()
    // Realistic combination: worktreePath is a path on the remote host, so it does not exist
    // locally — the host check must short-circuit before this is ever consulted.
    const pathExists = vi.fn().mockResolvedValue(false)
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: runCheck,
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveSkillsForDispatch: NO_SKILLS,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'remote',
      pathExists
    })

    await runner(PAYLOAD, writer)

    expect(writer.postStepVerification).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped', detail: { reason: 'remote_worktree' } })
    )
    expect(pathExists).not.toHaveBeenCalled()
    expect(runCheck).not.toHaveBeenCalled()
  })

  it('treats an unknown worktree host as local and runs the check', async () => {
    const writer = makeWriter()
    const runCheck = vi.fn().mockResolvedValue({ status: 'passed', detail: {} })
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: runCheck,
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveSkillsForDispatch: NO_SKILLS,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'unknown',
      pathExists: async () => true
    })

    await runner(PAYLOAD, writer)

    expect(runCheck).toHaveBeenCalled()
  })

  it('runs the check with the injected base ref and git options, and posts the result', async () => {
    const writer = makeWriter()
    const runCheck = vi.fn().mockResolvedValue({
      status: 'passed',
      detail: {
        threshold: 0.8,
        ratio: 0.9,
        total: 10,
        covered: 9,
        perFile: [],
        baseRef: 'develop'
      }
    })
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: runCheck,
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveSkillsForDispatch: NO_SKILLS,
      resolveBaseRef: async () => ({ baseRef: 'develop', gitOptions: { wslDistro: 'Ubuntu' } }),
      resolveWorktreeHost: async () => 'local',
      pathExists: async () => true
    })

    await runner(PAYLOAD, writer)

    expect(runCheck).toHaveBeenCalledWith({
      worktreePath: '/repo',
      baseRef: 'develop',
      gitOptions: { wslDistro: 'Ubuntu' },
      check: CHECK
    })
    expect(writer.postStepVerification).toHaveBeenCalledWith({
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'ctx_1',
      kind: 'diff_coverage',
      name: 'Diff coverage ≥ 80%',
      required: true,
      status: 'passed',
      detail: {
        threshold: 0.8,
        ratio: 0.9,
        total: 10,
        covered: 9,
        perFile: [],
        baseRef: 'develop'
      }
    })
  })

  it('does not post when the row timeout aborted the signal while the check ran', async () => {
    const writer = makeWriter()
    const controller = new AbortController()
    // Simulates runDiffCoverageCheck still resolving after the worker gave up on the row
    // and aborted: the abort happens mid-flight, before the (stale) result comes back.
    const runCheck = vi.fn().mockImplementation(async () => {
      controller.abort()
      return { status: 'error', detail: { stage: 'command', code: null } }
    })
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: runCheck,
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveSkillsForDispatch: NO_SKILLS,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'local',
      pathExists: async () => true
    })

    await runner(PAYLOAD, writer, { signal: controller.signal })

    expect(runCheck).toHaveBeenCalled()
    expect(writer.postStepVerification).not.toHaveBeenCalled()
  })

  it('forwards the signal to runDiffCoverageCheck', async () => {
    const writer = makeWriter()
    const runCheck = vi.fn().mockResolvedValue({ status: 'passed', detail: {} })
    const controller = new AbortController()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: runCheck,
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveSkillsForDispatch: NO_SKILLS,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'local',
      pathExists: async () => true
    })

    await runner(PAYLOAD, writer, { signal: controller.signal })

    expect(runCheck).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
  })
})

describe('contract_acknowledged', () => {
  const CONTRACT_CHECK = { kind: 'contract_acknowledged' } as const

  it('posts the contract verdict under its own kind, with no git worktree needed', async () => {
    const writer = makeWriter()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CONTRACT_CHECK],
      runDiffCoverageCheck: vi.fn(),
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveSkillsForDispatch: NO_SKILLS,
      runContractAcknowledgedCheck: async () => ({
        status: 'failed' as const,
        detail: { unacknowledged: 1 }
      }),
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'local',
      pathExists: async () => false
    })

    await runner(PAYLOAD, writer)

    expect(writer.postStepVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'contract_acknowledged',
        name: 'Breaking contracts acknowledged',
        required: true,
        status: 'failed',
        detail: { unacknowledged: 1 }
      })
    )
  })

  it('skips a remote worktree — the registry is a file on the execution host', async () => {
    const writer = makeWriter()
    const runContract = vi.fn()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CONTRACT_CHECK],
      runDiffCoverageCheck: vi.fn(),
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      runContractAcknowledgedCheck: runContract,
      resolveSkillsForDispatch: NO_SKILLS,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'remote'
    })

    await runner(PAYLOAD, writer)

    expect(runContract).not.toHaveBeenCalled()
    expect(writer.postStepVerification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'contract_acknowledged', status: 'skipped' })
    )
  })

  it('runs every authored check, resolving the host once', async () => {
    const writer = makeWriter()
    const resolveWorktreeHost = vi.fn().mockResolvedValue('local')
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK, CONTRACT_CHECK],
      runDiffCoverageCheck: vi.fn().mockResolvedValue({ status: 'passed', detail: {} }),
      runContractAcknowledgedCheck: async () => ({ status: 'passed' as const, detail: {} }),
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveSkillsForDispatch: NO_SKILLS,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost,
      pathExists: async () => true
    })

    await runner(PAYLOAD, writer)

    expect(resolveWorktreeHost).toHaveBeenCalledTimes(1)
    const kinds = vi
      .mocked(writer.postStepVerification)
      .mock.calls.map(([input]) => (input as { kind: string }).kind)
    expect(kinds).toEqual(['diff_coverage', 'contract_acknowledged'])
  })

  it("runs a skill check against the member's resolved skills", async () => {
    const writer = makeWriter()
    const resolveSkillsForDispatch = vi.fn().mockResolvedValue({
      resolved: [{ name: 'security-review', scope: 'org', versionId: 'v5', skillId: 'sk-1' }],
      catalogNameById: new Map([['sk-1', 'security-review']])
    })
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [{ kind: 'skill', skillId: 'sk-1' }],
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      runDiffCoverageCheck: vi.fn(),
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      resolveSkillsForDispatch,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'local'
    })

    await runner(PAYLOAD, writer)

    expect(resolveSkillsForDispatch).toHaveBeenCalledWith({
      projectId: 'proj_1',
      dispatchId: 'ctx_1',
      worktreePath: '/repo'
    })
    expect(writer.postStepVerification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'skill', name: 'sk-1', status: 'passed', required: true })
    )
  })

  it('fails a skill check the member never resolved — it no longer gates forever', async () => {
    const writer = makeWriter()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [{ kind: 'skill', skillId: 'sk-1', versionId: 'v2' }],
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      runDiffCoverageCheck: vi.fn(),
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      resolveSkillsForDispatch: async () => ({
        resolved: [],
        catalogNameById: new Map([['sk-1', 'security-review']])
      }),
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'local'
    })

    await runner(PAYLOAD, writer)

    expect(writer.postStepVerification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'skill', name: 'sk-1@v2', status: 'failed' })
    )
  })

  it('skips a skill check on a remote worktree — the repo scope is scanned on the execution host', async () => {
    const writer = makeWriter()
    const resolveSkillsForDispatch = vi.fn()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [{ kind: 'skill', skillId: 'sk-1' }],
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      runDiffCoverageCheck: vi.fn(),
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      resolveSkillsForDispatch,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'remote'
    })

    await runner(PAYLOAD, writer)

    expect(resolveSkillsForDispatch).not.toHaveBeenCalled()
    expect(writer.postStepVerification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'skill', status: 'skipped' })
    )
  })
})

// IV1: the named repo's own host decides where the command runs, so this branch deliberately does
// not consult the dispatch worktree's host the way the other two do.
describe('integration_verify', () => {
  const INTEGRATION_CHECK = {
    kind: 'integration_verify',
    command: 'pnpm run test:integration',
    repoId: 'repo-api'
  } as const

  it('posts a repo-named row and never asks the dispatch worktree host', async () => {
    const writer = makeWriter()
    const resolveWorktreeHost = vi.fn().mockResolvedValue('remote')
    const runIntegrationVerifyCheck = vi
      .fn()
      .mockResolvedValue({ status: 'failed', detail: { exitCode: 1 } })
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [INTEGRATION_CHECK],
      resolveSkillsForDispatch: NO_SKILLS,
      runDiffCoverageCheck: vi.fn(),
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      runIntegrationVerifyCheck,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost
    })

    await runner(PAYLOAD, writer)

    expect(resolveWorktreeHost).not.toHaveBeenCalled()
    expect(runIntegrationVerifyCheck).toHaveBeenCalledWith(
      expect.objectContaining({ check: INTEGRATION_CHECK, taskId: 'task_1', worktreeId: 'wt_1' })
    )
    expect(writer.postStepVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'integration_verify',
        name: 'Integration verify (repo-api)',
        required: true,
        status: 'failed'
      })
    )
  })

  it('gives each authored repo its own row', async () => {
    const writer = makeWriter()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [
        INTEGRATION_CHECK,
        { ...INTEGRATION_CHECK, repoId: 'repo-web' }
      ],
      resolveSkillsForDispatch: NO_SKILLS,
      runDiffCoverageCheck: vi.fn(),
      runContractAcknowledgedCheck: NO_CONTRACT_CHECK,
      runIntegrationVerifyCheck: NO_INTEGRATION_CHECK,
      resolveBaseRef: RESOLVE_ORIGIN_MAIN,
      resolveWorktreeHost: async () => 'local'
    })

    await runner(PAYLOAD, writer)

    const names = vi
      .mocked(writer.postStepVerification)
      .mock.calls.map(([input]) => (input as { name: string }).name)
    expect(names).toEqual(['Integration verify (repo-api)', 'Integration verify (repo-web)'])
  })
})
