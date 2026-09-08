import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { WorktreeChangedFilesReader } from './run-blast-radius'

/** Only the worktree fields the reader needs; keeps this off the full `Worktree` type. */
export type ChangedFilesWorktree = { id: string; path: string; hostId?: string | null }

export type WorktreeChangedFilesDeps = {
  showManagedWorktree: (selector: string) => Promise<ChangedFilesWorktree>
  /** BR1 reuses D6's authored-base resolution rather than guessing a base ref of its own. */
  resolveBaseRef: (
    worktreeId: string,
    worktreePath: string
  ) => Promise<{ baseRef: string; gitOptions: { wslDistro?: string } }>
  gitExec?: (args: string[], cwd: string, wslDistro?: string) => Promise<string>
}

async function defaultGitExec(args: string[], cwd: string, wslDistro?: string): Promise<string> {
  const { stdout } = await gitExecFileAsync(args, {
    cwd,
    ...(wslDistro ? { wslDistro } : {}),
    admissionTier: 'interactive'
  })
  return stdout
}

function parsePathList(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Every file a worktree has changed against its authored base — committed, staged, unstaged and
 * untracked.
 *
 * Measured from git, never from the worker's own `filesModified` report. That report is written by
 * the member the budget is judging, and a budget a member can under-report is not a budget.
 *
 * All three commands are scoped to this one worktree with no ref fan-out (Git Scan Safety), and
 * every option predates the Git 2.25 baseline. `core.quotePath=false` keeps non-ASCII paths
 * unquoted so they survive the protected-path match; the paths git returns are always
 * repo-relative and POSIX-separated, on every platform.
 *
 * Null, never an empty list, when the worktree cannot be read here: an SSH worktree belongs to its
 * execution host and loss of contact is not evidence, and a folder workspace that is not a
 * repository has no diff to take.
 */
export function createWorktreeChangedFilesReader(
  deps: WorktreeChangedFilesDeps
): WorktreeChangedFilesReader {
  const gitExec = deps.gitExec ?? defaultGitExec

  return async (worktreeId) => {
    let worktree: ChangedFilesWorktree
    try {
      worktree = await deps.showManagedWorktree(`id:${worktreeId}`)
    } catch {
      return null
    }
    if (worktree.hostId && worktree.hostId !== LOCAL_EXECUTION_HOST_ID) {
      return null
    }
    if (!worktree.path) {
      return null
    }

    let baseRef: string
    let wslDistro: string | undefined
    try {
      const resolved = await deps.resolveBaseRef(worktreeId, worktree.path)
      baseRef = resolved.baseRef
      wslDistro = resolved.gitOptions.wslDistro
    } catch {
      return null
    }

    const quiet = ['-c', 'core.quotePath=false']
    try {
      const [committed, working, untracked] = await Promise.all([
        gitExec(
          [...quiet, 'diff', '--name-only', '--no-renames', `${baseRef}...HEAD`],
          worktree.path,
          wslDistro
        ),
        gitExec(
          [...quiet, 'diff', '--name-only', '--no-renames', 'HEAD'],
          worktree.path,
          wslDistro
        ),
        gitExec([...quiet, 'ls-files', '--others', '--exclude-standard'], worktree.path, wslDistro)
      ])
      return [
        ...new Set([
          ...parsePathList(committed),
          ...parsePathList(working),
          ...parsePathList(untracked)
        ])
      ]
    } catch {
      return null
    }
  }
}
