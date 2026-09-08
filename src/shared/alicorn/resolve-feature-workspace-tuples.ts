/**
 * MR1 — turning a task's stored tuples into routable ones.
 *
 * A stored tuple names a workspace; it does not say where that workspace lives, because a repo can
 * be re-homed under a bound task. Resolution happens here, at use time, against the same two
 * resolvers the rest of the app routes with — `resolveWorktreeExecutionHost` for git worktrees and
 * `resolveFolderWorkspaceHost` for folder workspaces. Both fail closed, and so does this: a tuple
 * whose host cannot be determined is returned as *unresolved*, never as `local`. Guessing `local`
 * for a remote workspace is how a client ends up reading an SSH host's files off its own disk.
 */
import {
  resolveFolderWorkspaceHost,
  type FolderWorkspaceHostState
} from '../folder-workspace-execution-host'
import { getRepoKind } from '../repo-kind'
import { parseWorkspaceKey } from '../workspace-scope'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../execution-host'
import {
  createRepoRowExecutionHostLookup,
  resolveWorktreeExecutionHost
} from '../worktree-execution-host-resolution'
import type { ResolvedTaskWorktreeTuple, TaskWorktreeTuple } from './feature-workspace-tuples'

/** The git worktree facts resolution needs. A `Worktree` satisfies it structurally. */
export type GitWorktreeLocation = {
  path: string
  hostId?: string | null
}

export type FeatureWorkspaceResolutionState = FolderWorkspaceHostState & {
  /** Discovered git worktrees by `Worktree.id`. Absent means the workspace is gone from disk. */
  gitWorktreesById: ReadonlyMap<string, GitWorktreeLocation>
}

/**
 * Why the reasons stay separate: `workspace_missing` is a bound workspace that no longer exists and
 * the user can re-pick, while the three host failures are routing verdicts a caller must not act
 * on. Collapsing them loses the difference at the first caller that switches on it.
 */
export type TupleResolutionFailure =
  | 'workspace_missing'
  | 'host_ambiguous'
  | 'host_unknown'
  | 'host_malformed'

export type UnresolvedTaskWorktreeTuple = {
  tuple: TaskWorktreeTuple
  reason: TupleResolutionFailure
}

export type FeatureWorkspaceResolution = {
  /** In the stored order, so the primary still leads. */
  resolved: ResolvedTaskWorktreeTuple[]
  unresolved: UnresolvedTaskWorktreeTuple[]
}

type HostResolution =
  | { ok: true; executionHostId: ResolvedTaskWorktreeTuple['executionHostId'] }
  | { ok: false; reason: TupleResolutionFailure }

function resolveFolderTuple(
  tuple: TaskWorktreeTuple,
  folderWorkspaceId: string,
  state: FeatureWorkspaceResolutionState
): ResolvedTaskWorktreeTuple | UnresolvedTaskWorktreeTuple {
  const workspace = state.folderWorkspaces.find((entry) => entry.id === folderWorkspaceId)
  if (!workspace) {
    return { tuple, reason: 'workspace_missing' }
  }
  const host = resolveFolderWorkspaceHost(state, folderWorkspaceId)
  if (host.kind === 'missing') {
    return { tuple, reason: 'workspace_missing' }
  }
  if (host.kind === 'ambiguous') {
    return { tuple, reason: 'host_ambiguous' }
  }
  return {
    ...tuple,
    repoKind: 'folder',
    executionHostId:
      host.kind === 'ssh' ? toSshExecutionHostId(host.targetId) : LOCAL_EXECUTION_HOST_ID,
    path: workspace.folderPath
  }
}

function resolveGitHost(
  tuple: TaskWorktreeTuple,
  location: GitWorktreeLocation,
  lookup: ReturnType<typeof createRepoRowExecutionHostLookup>
): HostResolution {
  const resolution = resolveWorktreeExecutionHost(lookup, {
    repoId: tuple.repoId,
    hostId: location.hostId
  })
  if (resolution.kind === 'resolved') {
    return { ok: true, executionHostId: resolution.hostId }
  }
  switch (resolution.reason) {
    case 'ambiguous':
      return { ok: false, reason: 'host_ambiguous' }
    case 'malformed':
      return { ok: false, reason: 'host_malformed' }
    case 'unknown':
      return { ok: false, reason: 'host_unknown' }
  }
}

export function resolveTaskWorktreeTuples(
  tuples: readonly TaskWorktreeTuple[],
  state: FeatureWorkspaceResolutionState
): FeatureWorkspaceResolution {
  const lookup = createRepoRowExecutionHostLookup(state.repos)
  const resolved: ResolvedTaskWorktreeTuple[] = []
  const unresolved: UnresolvedTaskWorktreeTuple[] = []

  for (const tuple of tuples) {
    const scope = parseWorkspaceKey(tuple.worktreeId)
    if (scope?.type === 'folder') {
      const outcome = resolveFolderTuple(tuple, scope.folderWorkspaceId, state)
      if ('reason' in outcome) {
        unresolved.push(outcome)
      } else {
        resolved.push(outcome)
      }
      continue
    }
    const location = state.gitWorktreesById.get(tuple.worktreeId)
    if (!location) {
      unresolved.push({ tuple, reason: 'workspace_missing' })
      continue
    }
    const host = resolveGitHost(tuple, location, lookup)
    if (!host.ok) {
      unresolved.push({ tuple, reason: host.reason })
      continue
    }
    // The repo row is the authority on kind: a *folder project* is a non-git repo whose workspaces
    // still carry worktree-shaped ids, so the id prefix cannot answer this. Absent row reads as
    // git, matching `getRepoKind`'s own default.
    const repo = state.repos.find((entry) => entry.id === tuple.repoId)
    resolved.push({
      ...tuple,
      repoKind: repo ? getRepoKind(repo) : 'git',
      executionHostId: host.executionHostId,
      path: location.path
    })
  }

  return { resolved, unresolved }
}
