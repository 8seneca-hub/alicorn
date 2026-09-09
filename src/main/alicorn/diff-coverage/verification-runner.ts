import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { VerificationRunner } from '../verification-worker'
import type { LedgerWriter } from '../ledger/ledger-writer'
import type { StepVerificationInput } from '../../../shared/alicorn/ledger-inputs'
import type { IntegrationVerifyCheck, RequiredCheck } from '../../../shared/alicorn/members'
import { requiredCheckName } from '../../../shared/alicorn/required-check-name'
import type { runDiffCoverageCheck } from './diff-coverage-check'
import type { ContractCheckResult } from '../contracts/contract-acknowledged-check'
import type { IntegrationVerifyResult } from '../integration-verify/integration-verify-check'

type VerificationPayload = Parameters<VerificationRunner>[0]

export type WorktreeHost = 'local' | 'remote' | 'unknown'

export type VerificationRunnerDeps = {
  fetchRequiredChecks: (projectId: string) => Promise<RequiredCheck[]>
  runDiffCoverageCheck: typeof runDiffCoverageCheck
  /** CR2. Reads the run's Contract Registry and the Control API's acknowledgements. */
  runContractAcknowledgedCheck: (input: {
    worktreePath: string
    runId: string
    projectId: string
  }) => Promise<ContractCheckResult>
  /**
   * IV1. Resolves the task's bound workspaces and runs the command on the named repo's own host —
   * which is why this branch does not consult the dispatch worktree's host at all.
   */
  runIntegrationVerifyCheck: (input: {
    check: IntegrationVerifyCheck
    taskId: string
    worktreeId: string
    signal?: AbortSignal
  }) => Promise<IntegrationVerifyResult>
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

/**
 * Drainer branch (C3) for `step_verification` rows: one row runs every check the project authored.
 *
 * A check kind the project did not author is never run, and an unknown kind is ignored rather than
 * failed — the authored list is the question and this is only the answer.
 */
export function createVerificationRunner(deps: VerificationRunnerDeps): VerificationRunner {
  const pathExists = deps.pathExists ?? defaultPathExists

  return async (payload, writer, options) => {
    // A member cannot loosen its own criteria: checks come from the project's admin-authored list.
    const checks = await deps.fetchRequiredChecks(payload.projectId)
    if (checks.length === 0) {
      return
    }
    // Both checks read the worktree, whose path belongs to the execution host — so the host answer
    // is resolved once, and lazily, so a project with no authored checks never pays for it.
    let host: WorktreeHost | null = null
    const isRemote = async (): Promise<boolean> => {
      host ??= await deps.resolveWorktreeHost(payload.worktreeId)
      return host === 'remote'
    }

    for (const check of checks) {
      const name = requiredCheckName(check)
      if (check.kind === 'diff_coverage') {
        const post = (status: StepVerificationInput['status'], detail: Record<string, unknown>) =>
          postVerification(writer, payload, 'diff_coverage', name, status, detail)

        // Host check first: worktreePath is a path on the execution host, so testing it against the
        // local filesystem before knowing the host is wrong either way — false-not-a-git-worktree
        // for a real SSH worktree, or a same-named local directory silently posted to the ledger.
        if (await isRemote()) {
          await post('skipped', { reason: 'remote_worktree' })
          continue
        }
        if (!(await pathExists(join(payload.worktreePath, '.git')))) {
          await post('skipped', { reason: 'not_a_git_worktree' })
          continue
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
        // The worker already abandoned this row (row timeout) and moved on; posting a stale
        // result here could overwrite the retry's real verdict (step_verifications upserts
        // last-writer-wins on dispatch/kind/name).
        if (options?.signal?.aborted) {
          return
        }
        await post(status, detail)
        continue
      }

      if (check.kind === 'contract_acknowledged') {
        const post = (status: StepVerificationInput['status'], detail: Record<string, unknown>) =>
          postVerification(writer, payload, 'contract_acknowledged', name, status, detail)
        // The journal holding the registry is a file on the execution host, so the same rule
        // applies: no local read may stand in for a remote one.
        if (await isRemote()) {
          await post('skipped', { reason: 'remote_worktree' })
          continue
        }
        const { status, detail } = await deps.runContractAcknowledgedCheck({
          worktreePath: payload.worktreePath,
          runId: payload.runId,
          projectId: payload.projectId
        })
        if (options?.signal?.aborted) {
          return
        }
        await post(status, detail)
        continue
      }

      if (check.kind === 'integration_verify') {
        const { status, detail } = await deps.runIntegrationVerifyCheck({
          check,
          taskId: payload.taskId,
          worktreeId: payload.worktreeId,
          ...(options?.signal ? { signal: options.signal } : {})
        })
        if (options?.signal?.aborted) {
          return
        }
        await postVerification(writer, payload, 'integration_verify', name, status, detail)
      }
    }
  }
}

async function postVerification(
  writer: LedgerWriter,
  payload: VerificationPayload,
  kind: StepVerificationInput['kind'],
  name: string,
  status: StepVerificationInput['status'],
  detail: Record<string, unknown>
): Promise<void> {
  await writer.postStepVerification({
    runId: payload.runId,
    taskId: payload.taskId,
    dispatchId: payload.dispatchId,
    kind,
    name,
    required: true,
    status,
    detail
  })
}
