import { describe, expect, it, vi } from 'vitest'
import { runDiffCoverageCheck } from './diff-coverage-check'
import type { DiffCoverageCheck } from '../../../shared/alicorn/members'
import type { ProcessResult } from '../../../shared/child-process/process-spec'
import type { runProcess as RunProcessFn } from '../../../shared/child-process/run-process'
import type { readFile as ReadFileFn } from 'node:fs/promises'

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

  it('runs git diff -U0 --no-color <base>...HEAD', async () => {
    const gitExec = fakeGitExec()

    await runDiffCoverageCheck({
      worktreePath: '/repo',
      baseRef: 'origin/main',
      check: CHECK,
      gitExec,
      readFile: fakeReadFile()
    })

    expect(gitExec).toHaveBeenCalledWith(['diff', '-U0', '--no-color', 'origin/main...HEAD'])
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
