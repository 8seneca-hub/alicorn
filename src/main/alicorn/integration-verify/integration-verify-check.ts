import { runProcess as defaultRunProcess } from '../../../shared/child-process/run-process'
import { isWindowsAbsolutePathLike } from '../../../shared/cross-platform-path'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../shared/execution-host'
import { partitionTuplesByReachability } from '../../../shared/alicorn/feature-workspace-tuples'
import type { IntegrationVerifyCheck } from '../../../shared/alicorn/members'
import type { StepVerificationInput } from '../../../shared/alicorn/ledger-inputs'

/**
 * IV1 — does the feature still work across the repositories it spans?
 *
 * The command is admin-authored on the check and runs in the *named* repo's workspace, on that
 * workspace's own execution host, with the task's other same-host worktree paths exported so a
 * cross-repo suite can find them. A folder workspace is a first-class member of a feature
 * workspace, so nothing here requires git.
 *
 * Fail closed, and keep the two failures apart: a command that ran and said no is `failed`, while
 * an unreachable host, a timeout or a repo that is not bound is `skipped` — unknown, not a pass and
 * not proof of a break. Loss of contact with an execution host is never evidence
 * (`docs/reference/ssh-execution-boundary.md`).
 */

/** Decision 6. Long enough for a real cross-repo suite, short enough that a wedged one stops. */
export const INTEGRATION_VERIFY_TIMEOUT_MS = 15 * 60_000
/** Matches diff_coverage's cap, which matches the step-outcome report cap. */
const STDERR_TAIL_MAX_CHARS = 4000
const MAX_OUTPUT_BYTES = 1_000_000

export type IntegrationVerifyStatus = StepVerificationInput['status']

export type IntegrationVerifyResult = {
  status: IntegrationVerifyStatus
  detail: Record<string, unknown>
}

/**
 * One of the task's bound (repo, branch, worktree) tuples, resolved to a path and a host.
 *
 * `executionHostId` is `null` when resolution failed — the MR1 resolvers answer `unresolved`, never
 * `local`, and reading a remote workspace off this disk is exactly what that rule prevents.
 */
export type IntegrationVerifyWorkspace = {
  repoId: string
  worktreeId: string
  /** Absolute path *on `executionHostId`*. It names nothing on any other host. */
  path: string
  executionHostId: ExecutionHostId | null
}

/** The relay's `agent.execNonInteractive` shape, narrowed to what a check needs. */
export type IntegrationVerifyHostExec = (input: {
  executionHostId: ExecutionHostId
  binary: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  signal?: AbortSignal
}) => Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  canceled?: boolean
  spawnError?: string
}>

export type RunIntegrationVerifyCheckInput = {
  check: IntegrationVerifyCheck
  /** Resolved at use time, never stored: a repo can be re-homed under an already-bound task. */
  workspaces: readonly IntegrationVerifyWorkspace[]
  /** Absent means no live provider for that host — unreachable, which is not a verdict. */
  hostExec?: IntegrationVerifyHostExec
  runProcess?: typeof defaultRunProcess
  timeoutMs?: number
  /** Ties the command to the verification worker's row-level timeout. */
  signal?: AbortSignal
}

/**
 * `ALICORN_WORKTREE_<REPO>` — the repo id upper-cased with everything else collapsed to `_`.
 *
 * Two repo ids can slug to one name (`api-v2` and `api.v2`); last write wins and the detail lists
 * every export, so a collision is visible in the ledger rather than silent in the command.
 */
export function worktreePathEnvName(repoId: string): string {
  const slug = repoId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `ALICORN_WORKTREE_${slug || 'UNNAMED'}`
}

/**
 * The paths the command may see: every bound workspace that lives on the same host as the target,
 * the target included so one rule covers every tuple.
 *
 * Partitioned by *ownership*, not liveness — a path on another host would send the command to a
 * wrong-or-absent directory, and whether that host is up is a different question entirely.
 */
export function integrationVerifyEnv(
  workspaces: readonly IntegrationVerifyWorkspace[],
  onHost: ExecutionHostId
): { env: Record<string, string>; offHostRepoIds: string[] } {
  const routable = workspaces.filter(
    (workspace): workspace is IntegrationVerifyWorkspace & { executionHostId: ExecutionHostId } =>
      workspace.executionHostId !== null
  )
  const { reachable, unreachable } = partitionTuplesByReachability(routable, onHost)
  const env: Record<string, string> = {}
  for (const workspace of reachable) {
    env[worktreePathEnvName(workspace.repoId)] = workspace.path
  }
  const unresolved = workspaces.filter((workspace) => workspace.executionHostId === null)
  return {
    env,
    offHostRepoIds: [...unreachable, ...unresolved].map((workspace) => workspace.repoId)
  }
}

function shellInvocation(command: string, isWindows: boolean): { binary: string; args: string[] } {
  return isWindows
    ? { binary: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { binary: '/bin/sh', args: ['-lc', command] }
}

function verdictFromExit(
  exitCode: number | null,
  stderr: string,
  base: Record<string, unknown>
): IntegrationVerifyResult {
  if (exitCode === 0) {
    return { status: 'passed', detail: base }
  }
  if (exitCode === null) {
    // Ran, but told us nothing usable — a signal or a transport that lost the code.
    return { status: 'error', detail: { ...base, reason: 'no_exit_code' } }
  }
  return {
    status: 'failed',
    detail: { ...base, exitCode, stderrTail: stderr.slice(-STDERR_TAIL_MAX_CHARS) }
  }
}

export async function runIntegrationVerifyCheck(
  input: RunIntegrationVerifyCheckInput
): Promise<IntegrationVerifyResult> {
  const { check } = input
  const timeoutMs = input.timeoutMs ?? INTEGRATION_VERIFY_TIMEOUT_MS
  const target = input.workspaces.find((workspace) => workspace.repoId === check.repoId)
  if (!target) {
    // The check names a repo this task never bound. Not a pass: nobody looked.
    return { status: 'skipped', detail: { reason: 'repo_not_bound', repoId: check.repoId } }
  }
  if (target.executionHostId === null) {
    return {
      status: 'skipped',
      detail: { reason: 'execution_host_unresolved', repoId: target.repoId }
    }
  }
  const host = target.executionHostId
  const { env, offHostRepoIds } = integrationVerifyEnv(input.workspaces, host)
  const base: Record<string, unknown> = {
    repoId: target.repoId,
    executionHostId: host,
    worktreePaths: env,
    ...(offHostRepoIds.length > 0 ? { offHostRepoIds } : {})
  }

  if (host !== LOCAL_EXECUTION_HOST_ID) {
    if (!input.hostExec) {
      return {
        status: 'skipped',
        detail: { ...base, reason: 'execution_host_unreachable' }
      }
    }
    // The remote host's platform is not ours: an absolute path is the only shape of it we have.
    const { binary, args } = shellInvocation(check.command, isWindowsAbsolutePathLike(target.path))
    let remote: Awaited<ReturnType<IntegrationVerifyHostExec>>
    try {
      remote = await input.hostExec({
        executionHostId: host,
        binary,
        args,
        cwd: target.path,
        env,
        timeoutMs,
        ...(input.signal ? { signal: input.signal } : {})
      })
    } catch (error) {
      // The host owns the answer and we could not ask it. Never a fail.
      return {
        status: 'skipped',
        detail: { ...base, reason: 'execution_host_unreachable', error: String(error) }
      }
    }
    if (remote.timedOut) {
      return { status: 'skipped', detail: { ...base, reason: 'timed_out', timeoutMs } }
    }
    if (remote.canceled) {
      return { status: 'skipped', detail: { ...base, reason: 'canceled' } }
    }
    if (remote.spawnError) {
      return {
        status: 'error',
        detail: { ...base, reason: 'spawn_failed', error: remote.spawnError }
      }
    }
    return verdictFromExit(remote.exitCode, remote.stderr, base)
  }

  const runProcess = input.runProcess ?? defaultRunProcess
  const { binary, args } = shellInvocation(check.command, process.platform === 'win32')
  let local: Awaited<ReturnType<typeof defaultRunProcess>>
  try {
    local = await runProcess({
      program: binary,
      args,
      cwd: target.path,
      // Merged, not replaced: the command still needs PATH and the rest of its environment.
      env: { ...process.env, ...env },
      timeoutMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      ...(input.signal ? { signal: input.signal } : {})
    })
  } catch (error) {
    return { status: 'error', detail: { ...base, reason: 'spawn_failed', error: String(error) } }
  }
  if (local.timedOut) {
    return { status: 'skipped', detail: { ...base, reason: 'timed_out', timeoutMs } }
  }
  return verdictFromExit(local.code, local.stderr, base)
}
