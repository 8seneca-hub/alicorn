/**
 * MR1 — a feature workspace: one task bound to N (repo, branch, worktree) tuples.
 *
 * Keyed by task id. A task is Alicorn's unit of work and already owns task-scoped rows
 * (`alicorn_task_strategy`); keying by worktree is impossible here because having several
 * worktrees is the whole feature. Nothing about the renderer's worktree-keyed tab model moves —
 * UI5 re-keys tabs to the session on its own schedule, and this table is additive either way.
 */
import type { ExecutionHostId } from '../execution-host'
import type { RepoKind } from '../repo-types'

/** Persisted shape: mirrors `alicorn_task_worktrees` one-to-one and crosses the wire unchanged. */
export type TaskWorktreeTuple = {
  repoId: string
  worktreeId: string
  /** Branch bound at pick time. Null for a folder workspace or a detached HEAD — both are legal. */
  branch: string | null
  primary: boolean
}

/**
 * A tuple joined to the live repo/worktree registry. None of the added fields are persisted: a
 * repo can be re-homed (local → SSH) under an already-bound task, and a stored copy would be a
 * second source of truth that goes stale silently — the failure mode is running a remote
 * operation on the client.
 */
export type ResolvedTaskWorktreeTuple = TaskWorktreeTuple & {
  repoKind: RepoKind
  executionHostId: ExecutionHostId
  /** Absolute path *on `executionHostId`*. It names nothing on any other host. */
  path: string
}

export type TaskWorktreeTupleInput = {
  repoId: string
  worktreeId: string
  branch?: string | null
  primary?: boolean
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Identity inside a task's set is the **worktree**, not the repo.
 *
 * A folder workspace is projected as a `Worktree` whose `repoId` is
 * `folder-workspace:<projectGroupId>` (`folderWorkspaceToWorktree`), so every folder workspace in
 * one project group shares a repoId. Keying by repo would silently collapse a two-folder feature
 * workspace into one tuple. A worktree belongs to exactly one repo, so worktree identity is
 * strictly finer and never wrong.
 *
 * Normalizing also settles `primary`: exactly one tuple carries it and it sorts to index 0, so the
 * journal, the PR body and the scalar `worktree` a dispatch still expects all agree on which one.
 */
export function normalizeTaskWorktreeTuples(
  input: readonly TaskWorktreeTupleInput[]
): TaskWorktreeTuple[] {
  const byWorktree = new Map<string, TaskWorktreeTuple>()
  for (const entry of input) {
    const repoId = trimmedOrNull(entry.repoId)
    const worktreeId = trimmedOrNull(entry.worktreeId)
    if (!repoId || !worktreeId) {
      continue
    }
    // Last write per worktree wins; Map.set keeps the first insertion's position.
    byWorktree.set(worktreeId, {
      repoId,
      worktreeId,
      branch: trimmedOrNull(entry.branch),
      primary: entry.primary === true
    })
  }
  const tuples = [...byWorktree.values()]
  if (tuples.length === 0) {
    return []
  }
  const primaryIndex = tuples.findIndex((tuple) => tuple.primary)
  const chosen = primaryIndex === -1 ? 0 : primaryIndex
  const ordered = [tuples[chosen]!, ...tuples.filter((_, index) => index !== chosen)]
  return ordered.map((tuple, index) => ({ ...tuple, primary: index === 0 }))
}

export function primaryTaskWorktreeTuple(
  tuples: readonly TaskWorktreeTuple[]
): TaskWorktreeTuple | undefined {
  return tuples.find((tuple) => tuple.primary) ?? tuples[0]
}

/**
 * MR2's escalation signal: a task touching more than one repo is a candidate for
 * `execution_strategy: orchestrated`.
 *
 * Counts distinct repo ids, so two folder workspaces sharing one project group read as one repo.
 * That is deliberate — they are the same project, and under-offering costs nothing while
 * over-offering spends the north-star metric.
 */
export function spansMultipleRepos(tuples: readonly TaskWorktreeTuple[]): boolean {
  return new Set(tuples.map((tuple) => tuple.repoId)).size > 1
}

/**
 * Git repos bound more than once in one set. A worktree belongs to one repo, but nothing stops a
 * picker offering two branches of the same repo, and a cross-tuple git operation would then run
 * twice against one repository — competing index locks and a redundant fetch. Folder tuples are
 * excluded because their shared `folder-workspace:` repo id is a group, not a repository.
 */
export function duplicateGitRepoIds(tuples: readonly ResolvedTaskWorktreeTuple[]): string[] {
  const counts = new Map<string, number>()
  for (const tuple of tuples) {
    if (tuple.repoKind !== 'git') {
      continue
    }
    counts.set(tuple.repoId, (counts.get(tuple.repoId) ?? 0) + 1)
  }
  return [...counts].filter(([, count]) => count > 1).map(([repoId]) => repoId)
}

type ExecutionHostBound = { executionHostId: ExecutionHostId }

export type ExecutionHostTupleGroup<T extends ExecutionHostBound> = {
  executionHostId: ExecutionHostId
  tuples: T[]
}

/**
 * Cross-host feature workspaces are allowed: a frontend repo local and a backend repo on an SSH
 * box is a real shape, and refusing it would make the feature useless for the case that motivated
 * it. Every operation over the set therefore fans out per host and runs on that host's own
 * provider — the execution host owns everything touching execution, so nothing is ever answered
 * locally on a remote repo's behalf (`docs/reference/ssh-execution-boundary.md`).
 *
 * Groups keep first-seen order, so the primary tuple's host leads.
 */
export function groupTuplesByExecutionHost<T extends ExecutionHostBound>(
  tuples: readonly T[]
): ExecutionHostTupleGroup<T>[] {
  const groups = new Map<ExecutionHostId, T[]>()
  for (const tuple of tuples) {
    const existing = groups.get(tuple.executionHostId)
    if (existing) {
      existing.push(tuple)
    } else {
      groups.set(tuple.executionHostId, [tuple])
    }
  }
  return [...groups].map(([executionHostId, hostTuples]) => ({
    executionHostId,
    tuples: hostTuples
  }))
}

export function spansMultipleExecutionHosts(tuples: readonly ExecutionHostBound[]): boolean {
  return new Set(tuples.map((tuple) => tuple.executionHostId)).size > 1
}

export type TupleReachability<T extends ExecutionHostBound> = {
  /** Tuples whose paths exist on the asking host. */
  reachable: T[]
  /** Tuples on another host: real workspaces, but their paths mean nothing here. */
  unreachable: T[]
}

/**
 * A dispatched worker runs in one terminal on one host. Exporting a path that only exists on
 * another host sends it to a wrong-or-absent directory, so paths go into the environment only for
 * the tuples that share its host; the rest are named in the preamble as off-host.
 *
 * This is a partition by *ownership*, not by liveness. Being unreachable from here says nothing
 * about whether that host is up — `unverifiable` is a separate verdict and is not this function's
 * to give.
 */
export function partitionTuplesByReachability<T extends ExecutionHostBound>(
  tuples: readonly T[],
  fromHostId: ExecutionHostId
): TupleReachability<T> {
  const reachable: T[] = []
  const unreachable: T[] = []
  for (const tuple of tuples) {
    if (tuple.executionHostId === fromHostId) {
      reachable.push(tuple)
    } else {
      unreachable.push(tuple)
    }
  }
  return { reachable, unreachable }
}
