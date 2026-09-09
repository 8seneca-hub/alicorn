import { LOCAL_EXECUTION_HOST_ID, parseExecutionHostId } from '../../../shared/execution-host'
import type { TaskWorktreeTuple } from '../../../shared/alicorn/feature-workspace-tuples'
import { getSshGitProvider } from '../../providers/ssh-git-dispatch'
import type {
  IntegrationVerifyHostExec,
  IntegrationVerifyWorkspace
} from './integration-verify-check'

/** Only the worktree fields resolution needs; a `Worktree` satisfies it structurally. */
export type IntegrationVerifyWorktree = {
  id: string
  path: string
  repoId: string
  hostId?: string | null
}

export type TaskFeatureWorkspacesDeps = {
  listTaskWorktrees: (taskId: string) => TaskWorktreeTuple[]
  showManagedWorktree: (selector: string) => Promise<IntegrationVerifyWorktree>
}

/**
 * A stored tuple names a workspace; it does not say where that workspace lives, because a repo can
 * be re-homed under an already-bound task. So the host is read here, at use time, off the same
 * worktree record the rest of the runtime routes with — and an absent one is `null`, never `local`.
 */
function toWorkspace(
  tuple: Pick<TaskWorktreeTuple, 'repoId' | 'worktreeId'>,
  worktree: IntegrationVerifyWorktree
): IntegrationVerifyWorkspace {
  const parsed = worktree.hostId ? parseExecutionHostId(worktree.hostId) : null
  return {
    repoId: tuple.repoId,
    worktreeId: tuple.worktreeId,
    path: worktree.path,
    // A blank hostId is the stored spelling of local; a malformed one is unresolved, not local.
    executionHostId: worktree.hostId ? (parsed?.id ?? null) : LOCAL_EXECUTION_HOST_ID
  }
}

/**
 * The workspaces one task binds, resolved to paths and hosts.
 *
 * A task with no bound tuples is the pre-MR1 shape and still has exactly one workspace — the
 * dispatch's own — so an `integration_verify` check remains usable on a single-repo project. A
 * tuple whose workspace has gone from disk is dropped: the check then names a repo it cannot find
 * and reports `repo_not_bound`, which is unknown, not a pass.
 */
export function createTaskFeatureWorkspaceResolver(deps: TaskFeatureWorkspacesDeps) {
  return async (input: {
    taskId: string
    worktreeId: string
  }): Promise<IntegrationVerifyWorkspace[]> => {
    const tuples = deps.listTaskWorktrees(input.taskId)
    const wanted: Pick<TaskWorktreeTuple, 'repoId' | 'worktreeId'>[] =
      tuples.length > 0 ? tuples : [{ repoId: '', worktreeId: input.worktreeId }]
    const workspaces: IntegrationVerifyWorkspace[] = []
    for (const tuple of wanted) {
      try {
        const worktree = await deps.showManagedWorktree(`id:${tuple.worktreeId}`)
        workspaces.push(
          toWorkspace({ ...tuple, repoId: tuple.repoId || worktree.repoId }, worktree)
        )
      } catch {
        // Gone from disk, or not this host's to see. Either way it contributes no path.
      }
    }
    return workspaces
  }
}

/**
 * Runs the command on an SSH host through that host's own relay, never locally — the execution
 * host owns everything that touches execution. `undefined` when no provider is registered for the
 * target: that is loss of contact, which the caller reports as unknown rather than as a failure.
 *
 * Note the relay clamps `agent.execNonInteractive` to five minutes, so a remote check that runs
 * longer comes back `timedOut` well before IV1's own fifteen-minute ceiling.
 */
export const sshIntegrationVerifyHostExec: IntegrationVerifyHostExec = async (input) => {
  const parsed = parseExecutionHostId(input.executionHostId)
  if (parsed?.kind !== 'ssh') {
    throw new Error(`no execution provider for ${input.executionHostId}`)
  }
  const provider = getSshGitProvider(parsed.targetId)
  if (!provider) {
    throw new Error(`ssh provider unavailable for ${parsed.targetId}`)
  }
  return await provider.execNonInteractive(
    input.binary,
    input.args,
    input.cwd,
    input.timeoutMs,
    input.signal,
    input.env
  )
}
