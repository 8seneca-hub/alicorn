import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import { getBaseRefDefault as defaultGetBaseRefDefault } from '../../git/repo-default-base-ref'
import {
  getLocalProjectWorktreeGitOptions as defaultGetWorktreeGitOptions,
  type LocalProjectWorktreeGitOptions
} from '../../project-runtime-git-options'

export type ResolvedBaseRef = { baseRef: string; gitOptions: LocalProjectWorktreeGitOptions }

export type BaseRefResolverDeps = {
  store: Store | null
  showManagedWorktree: (selector: string) => Promise<{ id: string; repoId: string }>
  getBaseRefDefault?: typeof defaultGetBaseRefDefault
  getWorktreeGitOptions?: typeof defaultGetWorktreeGitOptions
}

const FALLBACK_BASE_REF = 'origin/main'
const UNRESOLVED: ResolvedBaseRef = { baseRef: FALLBACK_BASE_REF, gitOptions: {} }

/**
 * Same authored-base resolution order as the drift probe
 * (runtime-worktree-drift-probe.ts:34-39): a worktree- or repo-authored base wins
 * over git's own default-branch guess, with 'origin/main' as the final fallback
 * so the coverage check always has something to diff against.
 */
export function createBaseRefResolver(
  deps: BaseRefResolverDeps
): (worktreeId: string, worktreePath: string) => Promise<ResolvedBaseRef> {
  const getBaseRefDefault = deps.getBaseRefDefault ?? defaultGetBaseRefDefault
  const getWorktreeGitOptions = deps.getWorktreeGitOptions ?? defaultGetWorktreeGitOptions

  return async (worktreeId) => {
    const store = deps.store
    if (!store) {
      return UNRESOLVED
    }
    const worktree = await deps.showManagedWorktree(`id:${worktreeId}`)
    const repo = store.getRepos().find((candidate: Repo) => candidate.id === worktree.repoId)
    if (!repo || repo.connectionId) {
      return UNRESOLVED
    }
    const gitOptions = getWorktreeGitOptions(store, repo)
    const meta = store.getWorktreeMeta(worktree.id)
    const baseRef =
      meta?.baseRef ||
      meta?.sparseBaseRef ||
      repo.worktreeBaseRef ||
      (await getBaseRefDefault(repo.path, gitOptions)) ||
      FALLBACK_BASE_REF
    return { baseRef, gitOptions }
  }
}
