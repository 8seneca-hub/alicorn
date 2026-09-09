import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/process-spec'
import {
  CODE_STAGE_TIMEOUT_EXIT,
  codeStageOutcome,
  runCodeStage,
  type RunProcessFn,
  type CodeStageResult
} from './code-stage-runner'

function processResult(over: Partial<ProcessResult> = {}): ProcessResult {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, ...over }
}

function stageResult(over: Partial<CodeStageResult> = {}): CodeStageResult {
  return { exitCode: 0, durationMs: 1, stdoutTail: '', stderrTail: '', timedOut: false, ...over }
}

describe('runCodeStage', () => {
  it('runs the command in the workspace and reports the exit code', async () => {
    const exec = vi.fn<RunProcessFn>(async () =>
      processResult({ code: 0, stdout: 'formatted 3 files' })
    )

    const result = await runCodeStage({
      worktreePath: '/tmp/wt-1',
      command: 'pnpm format',
      exec
    })

    expect(result).toMatchObject({ exitCode: 0, stdoutTail: 'formatted 3 files' })
    const spec: ProcessSpec = exec.mock.calls[0]![0]
    expect(spec).toMatchObject({ program: 'pnpm', args: ['format'], cwd: '/tmp/wt-1' })
  })

  // Why argv and not a shell string: runProcess refuses `shell: true`, so the command has to arrive
  // already split. A single token is a program with no arguments.
  it('splits the command into program and arguments', async () => {
    const exec = vi.fn<RunProcessFn>(async () => processResult())

    await runCodeStage({
      worktreePath: '/tmp/wt',
      command: '  node  scripts/rank.mjs  --top 5 ',
      exec
    })

    expect(exec.mock.calls[0]![0]).toMatchObject({
      program: 'node',
      args: ['scripts/rank.mjs', '--top', '5']
    })
  })

  it('reports a non-zero exit as it is', async () => {
    const exec = vi.fn<RunProcessFn>(async () => processResult({ code: 2, stderr: 'lint failed' }))

    const result = await runCodeStage({ worktreePath: '/tmp/wt', command: 'pnpm lint', exec })

    expect(result).toMatchObject({ exitCode: 2, stderrTail: 'lint failed' })
  })

  // Why 124 and not null: an outcome must be succeeded or failed, and a killed stage is a failure
  // with a recognisable code rather than an absent one.
  it('reports a timeout as exit 124', async () => {
    const exec = vi.fn<RunProcessFn>(async () => processResult({ code: null, timedOut: true }))

    const result = await runCodeStage({ worktreePath: '/tmp/wt', command: 'sleep 999', exec })

    expect(result.exitCode).toBe(CODE_STAGE_TIMEOUT_EXIT)
    expect(result.timedOut).toBe(true)
  })

  it('treats a missing exit code as a failure rather than a success', async () => {
    const exec = vi.fn<RunProcessFn>(async () => processResult({ code: null }))

    const result = await runCodeStage({ worktreePath: '/tmp/wt', command: 'x', exec })

    expect(codeStageOutcome(result)).toBe('failed')
  })

  it('passes the caller timeout through', async () => {
    const exec = vi.fn<RunProcessFn>(async () => processResult())

    await runCodeStage({ worktreePath: '/tmp/wt', command: 'x', timeoutMs: 5_000, exec })

    expect(exec.mock.calls[0]![0]).toMatchObject({ timeoutMs: 5_000 })
  })

  // Why cap the tails: they land in `step_outcomes.report_summary`, which a human skims. A stage
  // printing a megabyte is not more explicable for it.
  it('keeps only the tail of a large output', async () => {
    const exec = vi.fn(async () =>
      processResult({ stdout: `${'x'.repeat(10_000)}END`, stderr: 'y'.repeat(10_000) })
    )

    const result = await runCodeStage({ worktreePath: '/tmp/wt', command: 'noisy', exec })

    expect(result.stdoutTail.length).toBeLessThanOrEqual(4096)
    expect(result.stdoutTail.endsWith('END')).toBe(true)
    expect(result.stderrTail.length).toBeLessThanOrEqual(4096)
  })

  it('measures how long the stage took', async () => {
    const exec = vi.fn<RunProcessFn>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 12))
      return processResult()
    })

    const result = await runCodeStage({ worktreePath: '/tmp/wt', command: 'x', exec })

    expect(result.durationMs).toBeGreaterThanOrEqual(10)
  })
})

describe('codeStageOutcome', () => {
  // Exit 0 is the only success: a code stage is deterministic, so anything else is a real failure
  // rather than something to interpret.
  it('succeeds only on exit 0', () => {
    expect(codeStageOutcome(stageResult({ exitCode: 0 }))).toBe('succeeded')
    expect(codeStageOutcome(stageResult({ exitCode: 1 }))).toBe('failed')
    expect(codeStageOutcome(stageResult({ exitCode: CODE_STAGE_TIMEOUT_EXIT }))).toBe('failed')
  })
})
