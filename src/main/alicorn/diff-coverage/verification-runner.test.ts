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

describe('createVerificationRunner', () => {
  it('resolves without posting when no diff_coverage check is configured', async () => {
    const writer = makeWriter()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [],
      runDiffCoverageCheck: vi.fn(),
      getBaseRefDefault: async () => 'origin/main',
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
      getBaseRefDefault: async () => 'origin/main',
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

  it('skips an SSH-hosted (remote) worktree', async () => {
    const writer = makeWriter()
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: vi.fn(),
      getBaseRefDefault: async () => 'origin/main',
      resolveWorktreeHost: async () => 'remote',
      pathExists: async () => true
    })

    await runner(PAYLOAD, writer)

    expect(writer.postStepVerification).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped', detail: { reason: 'remote_worktree' } })
    )
  })

  it('treats an unknown worktree host as local and runs the check', async () => {
    const writer = makeWriter()
    const runCheck = vi.fn().mockResolvedValue({ status: 'passed', detail: {} })
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: runCheck,
      getBaseRefDefault: async () => 'origin/main',
      resolveWorktreeHost: async () => 'unknown',
      pathExists: async () => true
    })

    await runner(PAYLOAD, writer)

    expect(runCheck).toHaveBeenCalled()
  })

  it('runs the check and posts the result on the happy path', async () => {
    const writer = makeWriter()
    const runCheck = vi.fn().mockResolvedValue({
      status: 'passed',
      detail: {
        threshold: 0.8,
        ratio: 0.9,
        total: 10,
        covered: 9,
        perFile: [],
        baseRef: 'origin/main'
      }
    })
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: runCheck,
      getBaseRefDefault: async () => 'origin/main',
      resolveWorktreeHost: async () => 'local',
      pathExists: async () => true
    })

    await runner(PAYLOAD, writer)

    expect(runCheck).toHaveBeenCalledWith({
      worktreePath: '/repo',
      baseRef: 'origin/main',
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
        baseRef: 'origin/main'
      }
    })
  })

  it('falls back to origin/main when getBaseRefDefault resolves null', async () => {
    const writer = makeWriter()
    const runCheck = vi.fn().mockResolvedValue({ status: 'failed', detail: {} })
    const runner = createVerificationRunner({
      fetchRequiredChecks: async () => [CHECK],
      runDiffCoverageCheck: runCheck,
      getBaseRefDefault: async () => null,
      resolveWorktreeHost: async () => 'local',
      pathExists: async () => true
    })

    await runner(PAYLOAD, writer)

    expect(runCheck).toHaveBeenCalledWith(expect.objectContaining({ baseRef: 'origin/main' }))
  })
})
