import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { VerificationRunner } from '../verification-worker'
import type { LedgerWriter } from '../ledger/ledger-writer'
import type { StepVerificationInput } from '../../../shared/alicorn/ledger-inputs'
import type { DiffCoverageCheck, RequiredCheck } from '../../../shared/alicorn/members'
import type { runDiffCoverageCheck } from './diff-coverage-check'

type VerificationPayload = Parameters<VerificationRunner>[0]

export type WorktreeHost = 'local' | 'remote' | 'unknown'

export type VerificationRunnerDeps = {
  fetchRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
  runDiffCoverageCheck: typeof runDiffCoverageCheck
  // Resolves the worktree's real configured base (and its git routing, e.g. WSL) the
  // same way the runtime drift probe does — see base-ref-resolver.ts.
  resolveBaseRef: (
    worktreeId: string,
    worktreePath: string
  ) => Promise<{ baseRef: string; gitOptions: { wslDistro?: string } }>
  // SSH-hosted worktrees are skipped (no local diff to run against); 'unknown' is treated as local.
  resolveWorktreeHost: (worktreeId: string) => Promise<WorktreeHost>
  pathExists?: (path: string) => Promise<boolean>
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function isDiffCoverageCheck(check: RequiredCheck): check is DiffCoverageCheck {
  return check.kind === 'diff_coverage'
}

/** Drainer branch (C3) for `step_verification` rows: today's only required check is diff_coverage. */
export function createVerificationRunner(deps: VerificationRunnerDeps): VerificationRunner {
  const pathExists = deps.pathExists ?? defaultPathExists

  return async (payload, writer, options) => {
    // A member cannot loosen its own criteria: checks come from the project's admin-authored list.
    const checks = await deps.fetchRequiredChecks(payload.projectId)
    const check = checks.find(isDiffCoverageCheck)
    if (!check) {
      return
    }

    const name = `Diff coverage ≥ ${Math.round(check.threshold * 100)}%`
    const post = (status: StepVerificationInput['status'], detail: Record<string, unknown>) =>
      postVerification(writer, payload, name, status, detail)

    // Host check first: worktreePath is a path on the execution host, so testing it against the
    // local filesystem before knowing the host is wrong either way — false-not-a-git-worktree for a
    // real SSH worktree, or a same-named local directory silently posted to the ledger instead.
    if ((await deps.resolveWorktreeHost(payload.worktreeId)) === 'remote') {
      return post('skipped', { reason: 'remote_worktree' })
    }

    if (!(await pathExists(join(payload.worktreePath, '.git')))) {
      return post('skipped', { reason: 'not_a_git_worktree' })
    }

    const { baseRef, gitOptions } = await deps.resolveBaseRef(
      payload.worktreeId,
      payload.worktreePath
    )
    const { status, detail } = await deps.runDiffCoverageCheck({
      worktreePath: payload.worktreePath,
      baseRef,
      gitOptions,
      check,
      signal: options?.signal
    })
    return post(status, detail)
  }
}

async function postVerification(
  writer: LedgerWriter,
  payload: VerificationPayload,
  name: string,
  status: StepVerificationInput['status'],
  detail: Record<string, unknown>
): Promise<void> {
  await writer.postStepVerification({
    runId: payload.runId,
    taskId: payload.taskId,
    dispatchId: payload.dispatchId,
    kind: 'diff_coverage',
    name,
    required: true,
    status,
    detail
  })
}
