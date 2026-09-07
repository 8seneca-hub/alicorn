import { describe, expect, it, vi } from 'vitest'
import { runDiffCoverageCheck } from './diff-coverage-check'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import type { DiffCoverageCheck } from '../../../shared/alicorn/members'
import type { ProcessResult } from '../../../shared/child-process/process-spec'
import type { runProcess as RunProcessFn } from '../../../shared/child-process/run-process'
import type { runWslProcess as RunWslFn, WslResult } from '../../wsl/wsl-runner'
import type { readFile as ReadFileFn } from 'node:fs/promises'

vi.mock('../../git/command-runner/git-exec-file', () => ({
  gitExecFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
}))

const CHECK: DiffCoverageCheck = {
  kind: 'diff_coverage',
  threshold: 0.5,
  lcovPath: 'coverage/lcov.info',
  timeoutMs: 30_000
}

const DIFF_TEXT = [
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,0 +11,2 @@',
  '+x',
  '+y',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -5,0 +6,3 @@',
  '+x',
  '+y',
  '+z'
].join('\n')

const LCOV_TEXT = [
  'SF:src/a.ts',
  'DA:11,3',
  'DA:12,0',
  'end_of_record',
  'SF:src/b.ts',
  'DA:6,3',
  'DA:7,3',
  'DA:8,0',
  'end_of_record'
].join('\n')

function fakeGitExec(stdout = DIFF_TEXT) {
  return vi.fn(async () => ({ stdout }))
}

function fakeReadFile(text = LCOV_TEXT): typeof ReadFileFn {
  return vi.fn(async () => text) as unknown as typeof ReadFileFn
}

function fakeRunProcess(result: Partial<ProcessResult> = {}): typeof RunProcessFn {
  const full: ProcessResult = {
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...result
  }
  return vi.fn(async () => full) as unknown as typeof RunProcessFn
}

function fakeRunWsl(result: Partial<WslResult> = {}): typeof RunWslFn {
  const full: WslResult = {
    environmentResolved: true,
    code: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...result
  }
  return vi.fn(async () => full) as unknown as typeof RunWslFn
}

describe('runDiffCoverageCheck', () => {
  it('errors when the command fails, without running git or reading lcov', async () => {
    const runProcess = fakeRunProcess({ code: 1, stderr: 'boom' })
    const gitExec = fakeGitExec()
    const readFile = fakeReadFile()

    const result = await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, command: 'pnpm test' },
      runProcess,
      gitExec,
      readFile
    })

    expect(result).toEqual({
      status: 'error',
      detail: { stage: 'command', code: 1, stderrTail: 'boom' }
    })
    expect(gitExec).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('includes timedOut in the error detail when the command times out', async () => {
    const runProcess = fakeRunProcess({ code: null, stderr: 'stuck', timedOut: true })

    const result = await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, command: 'pnpm test' },
      runProcess,
      gitExec: fakeGitExec(),
      readFile: fakeReadFile()
    })

    expect(result).toEqual({
      status: 'error',
      detail: { stage: 'command', code: null, stderrTail: 'stuck', timedOut: true }
    })
  })

  it('builds the Windows argv through runProcess rather than a shell', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const runProcess = fakeRunProcess()
      await runDiffCoverageCheck({
        worktreePath: '/repo',
        baseRef: 'origin/main',
        check: { ...CHECK, command: 'pnpm test' },
        runProcess,
        gitExec: fakeGitExec(),
        readFile: fakeReadFile()
      })

      expect(runProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          program: process.env.ComSpec ?? 'cmd.exe',
          args: ['/d', '/s', '/c', 'pnpm test'],
          cwd: '/repo',
          timeoutMs: 30_000,
          maxOutputBytes: 1_000_000
        })
      )
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('routes the coverage command through WSL for a WSL-hosted worktree', async () => {
    const runProcess = fakeRunProcess()
    const runWsl = fakeRunWsl()

    await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, command: 'pnpm test' },
      gitOptions: { wslDistro: 'Ubuntu' },
      runProcess,
      runWsl,
      gitExec: fakeGitExec(),
      readFile: fakeReadFile()
    })

    expect(runProcess).not.toHaveBeenCalled()
    expect(runWsl).toHaveBeenCalledTimes(1)
    const spec = vi.mocked(runWsl).mock.calls[0][0]
    expect(spec.distro).toBe('Ubuntu')
    expect(spec.loginPath).toBe('preferred')
    expect(spec.cwd).toBe('/repo')
    // Why script/shell, not program+'-lc': runWslProcess already injects the cached login
    // PATH/HOME, so -lc would re-enter the login shell the runner exists to avoid.
    expect(spec.script).toBe('pnpm test')
    expect(spec.shell).toBe('sh')
    expect(spec.program).toBeUndefined()
  })

  it('produces the same command-stage error shape as the host path on a non-zero WSL exit, plus environmentResolved', async () => {
    const runWsl = fakeRunWsl({ code: 2, stderr: 'boom' })

    const result = await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, command: 'pnpm test' },
      gitOptions: { wslDistro: 'Ubuntu' },
      runWsl,
      gitExec: fakeGitExec(),
      readFile: fakeReadFile()
    })

    expect(result).toEqual({
      status: 'error',
      detail: { stage: 'command', code: 2, stderrTail: 'boom', environmentResolved: true }
    })
  })

  it('forwards the signal to runWsl so an aborted check reaches the guest process', async () => {
    const runWsl = fakeRunWsl()
    const controller = new AbortController()

    await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, command: 'pnpm test' },
      gitOptions: { wslDistro: 'Ubuntu' },
      runWsl,
      gitExec: fakeGitExec(),
      readFile: fakeReadFile(),
      signal: controller.signal
    })

    expect(runWsl).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
  })

  it('marks a WSL command failure with environmentResolved: false when the login PATH could not be resolved', async () => {
    // exit 127 with an unresolved environment means the guest never had the
    // tool on any PATH -- a probe failure, not a real test failure.
    const runWsl = fakeRunWsl({
      code: 127,
      stderr: 'sh: pnpm: not found',
      environmentResolved: false
    })

    const result = await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, command: 'pnpm test' },
      gitOptions: { wslDistro: 'Ubuntu' },
      runWsl,
      gitExec: fakeGitExec(),
      readFile: fakeReadFile()
    })

    expect(result.detail).toMatchObject({ environmentResolved: false })
  })

  it('does not call runWsl when no wslDistro is set, and still forwards the signal to runProcess', async () => {
    const runProcess = fakeRunProcess()
    const runWsl = fakeRunWsl()
    const controller = new AbortController()

    await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, command: 'pnpm test' },
      runProcess,
      runWsl,
      gitExec: fakeGitExec(),
      readFile: fakeReadFile(),
      signal: controller.signal
    })

    expect(runWsl).not.toHaveBeenCalled()
    expect(runProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        program: '/bin/sh',
        args: ['-lc', 'pnpm test'],
        cwd: '/repo',
        timeoutMs: 30_000,
        maxOutputBytes: 1_000_000,
        signal: controller.signal
      })
    )
  })

  it('runs git diff with quotePath/ext-diff/prefix flags ahead of the ref range', async () => {
    const gitExec = fakeGitExec()

    await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: CHECK,
      gitExec,
      readFile: fakeReadFile()
    })

    expect(gitExec).toHaveBeenCalledWith(
      [
        '-c',
        'core.quotePath=false',
        'diff',
        '-U0',
        '--no-color',
        '--no-ext-diff',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        'origin/main...HEAD'
      ],
      { signal: undefined }
    )
  })

  it('forwards the signal to runProcess', async () => {
    const runProcess = fakeRunProcess()
    const controller = new AbortController()

    await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, command: 'pnpm test' },
      runProcess,
      gitExec: fakeGitExec(),
      readFile: fakeReadFile(),
      signal: controller.signal
    })

    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
  })

  it('forwards the signal to gitExec', async () => {
    const gitExec = fakeGitExec()
    const controller = new AbortController()

    await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: CHECK,
      gitExec,
      readFile: fakeReadFile(),
      signal: controller.signal
    })

    expect(gitExec).toHaveBeenCalledWith(expect.any(Array), { signal: controller.signal })
  })

  it('threads the resolved wslDistro git option into the default gitExec', async () => {
    await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: CHECK,
      gitOptions: { wslDistro: 'Ubuntu' },
      readFile: fakeReadFile()
    })

    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ cwd: '/repo', wslDistro: 'Ubuntu' })
    )
  })

  it('errors when the lcov file is missing', async () => {
    const readFile = vi.fn(async () => {
      throw new Error('ENOENT')
    }) as unknown as typeof ReadFileFn

    const result = await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: CHECK,
      gitExec: fakeGitExec(),
      readFile
    })

    expect(result).toEqual({
      status: 'error',
      detail: { stage: 'lcov', message: 'lcov file not found' }
    })
  })

  it('passes when the ratio meets the threshold', async () => {
    const result = await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, threshold: 0.5 },
      gitExec: fakeGitExec(),
      readFile: fakeReadFile()
    })

    expect(result.status).toBe('passed')
    expect(result.detail).toMatchObject({
      threshold: 0.5,
      ratio: 0.6,
      total: 5,
      covered: 3,
      baseRef: 'origin/main'
    })
  })

  it('fails when the ratio misses the threshold', async () => {
    const result = await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: { ...CHECK, threshold: 0.8 },
      gitExec: fakeGitExec(),
      readFile: fakeReadFile()
    })

    expect(result.status).toBe('failed')
    expect(result.detail).toMatchObject({ threshold: 0.8, ratio: 0.6 })
  })

  it('sorts perFile worst-first (most uncovered lines first)', async () => {
    const diff = [
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,0 +2,2 @@',
      '+a',
      '+b',
      '--- a/src/y.ts',
      '+++ b/src/y.ts',
      '@@ -1,0 +2,3 @@',
      '+a',
      '+b',
      '+c',
      '--- a/src/z.ts',
      '+++ b/src/z.ts',
      '@@ -1,0 +2,4 @@',
      '+a',
      '+b',
      '+c',
      '+d'
    ].join('\n')
    const lcov = [
      'SF:src/x.ts',
      'DA:2,1',
      'DA:3,1',
      'end_of_record',
      'SF:src/y.ts',
      'DA:2,0',
      'DA:3,0',
      'DA:4,0',
      'end_of_record',
      'SF:src/z.ts',
      'DA:2,1',
      'DA:3,1',
      'DA:4,0',
      'DA:5,0',
      'end_of_record'
    ].join('\n')

    const result = await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: CHECK,
      gitExec: fakeGitExec(diff),
      readFile: fakeReadFile(lcov)
    })

    const perFile = result.detail.perFile as { path: string }[]
    expect(perFile.map((f) => f.path)).toEqual(['src/y.ts', 'src/z.ts', 'src/x.ts'])
  })

  it('caps perFile at 20 entries', async () => {
    const fileCount = 25
    const diffLines: string[] = []
    const lcovLines: string[] = []
    for (let i = 0; i < fileCount; i++) {
      const path = `src/file${i}.ts`
      diffLines.push(`--- a/${path}`, `+++ b/${path}`, '@@ -1,0 +2,1 @@', '+x')
      lcovLines.push(`SF:${path}`, 'DA:2,0', 'end_of_record')
    }

    const result = await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: CHECK,
      gitExec: fakeGitExec(diffLines.join('\n')),
      readFile: fakeReadFile(lcovLines.join('\n'))
    })

    expect((result.detail.perFile as unknown[]).length).toBe(20)
  })
})
