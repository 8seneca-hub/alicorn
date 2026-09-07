import { readFile as fsReadFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess as defaultRunProcess } from '../../../shared/child-process/run-process'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import type { DiffCoverageCheck } from '../../../shared/alicorn/members'
import type { StepVerificationInput } from '../../../shared/alicorn/ledger-inputs'
import { parseLcov } from './lcov-parser'
import { addedLinesFromUnifiedDiff } from './unified-diff-added-lines'
import { computeDiffCoverage, normalizeLcovPath, type DiffCoveragePerFile } from './diff-coverage'

// Why 4000: matches step-outcome-builder's REPORT_SUMMARY_MAX_CHARS cap for the same reason.
const STDERR_TAIL_MAX_CHARS = 4000
const PER_FILE_WORST_LIMIT = 20

type RunDiffCoverageCheckStatus = StepVerificationInput['status']

export type RunDiffCoverageCheckInput = {
  worktreePath: string
  baseRef: string
  check: DiffCoverageCheck
  gitOptions?: { wslDistro?: string }
  runProcess?: typeof defaultRunProcess
  gitExec?: (argv: string[], options?: { signal?: AbortSignal }) => Promise<{ stdout: string }>
  readFile?: typeof fsReadFile
  /** Ties the command and the git diff to the worker's row-level timeout. */
  signal?: AbortSignal
}

export type RunDiffCoverageCheckResult = {
  status: RunDiffCoverageCheckStatus
  detail: Record<string, unknown>
}

/** Runs a project's diff_coverage required check: optional command, then diff x lcov. */
export async function runDiffCoverageCheck(
  input: RunDiffCoverageCheckInput
): Promise<RunDiffCoverageCheckResult> {
  const { worktreePath, baseRef, check } = input
  const runProcess = input.runProcess ?? defaultRunProcess
  const gitExec =
    input.gitExec ??
    ((argv: string[], options?: { signal?: AbortSignal }) =>
      gitExecFileAsync(argv, {
        cwd: worktreePath,
        ...(input.gitOptions?.wslDistro ? { wslDistro: input.gitOptions.wslDistro } : {}),
        admissionTier: 'interactive',
        signal: options?.signal
      }))
  const readFile = input.readFile ?? fsReadFile

  if (check.command) {
    const isWindows = process.platform === 'win32'
    const result = await runProcess({
      program: isWindows ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh',
      args: isWindows ? ['/d', '/s', '/c', check.command] : ['-lc', check.command],
      cwd: worktreePath,
      timeoutMs: check.timeoutMs,
      maxOutputBytes: 1_000_000,
      signal: input.signal
    })
    if (result.code !== 0) {
      return {
        status: 'error',
        detail: {
          stage: 'command',
          code: result.code,
          stderrTail: result.stderr.slice(-STDERR_TAIL_MAX_CHARS),
          ...(result.timedOut ? { timedOut: true } : {})
        }
      }
    }
  }

  let diffText: string
  try {
    // Why these flags: quotePath=false keeps non-ASCII paths unquoted, and the diff must
    // match unified-diff-added-lines' own assumptions (no external diff driver, a/ b/ prefixes).
    const diff = await gitExec(
      [
        '-c',
        'core.quotePath=false',
        'diff',
        '-U0',
        '--no-color',
        '--no-ext-diff',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        `${baseRef}...HEAD`
      ],
      { signal: input.signal }
    )
    diffText = diff.stdout
  } catch (error) {
    return {
      status: 'error',
      detail: { stage: 'git', message: error instanceof Error ? error.message : String(error) }
    }
  }

  let lcovText: string
  try {
    lcovText = (await readFile(join(worktreePath, check.lcovPath), 'utf8')) as string
  } catch {
    return { status: 'error', detail: { stage: 'lcov', message: 'lcov file not found' } }
  }

  const added = addedLinesFromUnifiedDiff(diffText)
  const covered = parseLcov(lcovText)
  const {
    total,
    covered: coveredCount,
    ratio,
    perFile
  } = computeDiffCoverage(added, covered, {
    normalize: (path) => normalizeLcovPath(path, worktreePath)
  })

  return {
    status: ratio >= check.threshold ? 'passed' : 'failed',
    detail: {
      threshold: check.threshold,
      ratio,
      total,
      covered: coveredCount,
      perFile: sortPerFileWorstFirst(perFile).slice(0, PER_FILE_WORST_LIMIT),
      baseRef
    }
  }
}

function sortPerFileWorstFirst(perFile: DiffCoveragePerFile[]): DiffCoveragePerFile[] {
  return [...perFile].sort((a, b) => {
    const uncoveredDelta = b.total - b.covered - (a.total - a.covered)
    return uncoveredDelta !== 0 ? uncoveredDelta : a.path.localeCompare(b.path)
  })
}
