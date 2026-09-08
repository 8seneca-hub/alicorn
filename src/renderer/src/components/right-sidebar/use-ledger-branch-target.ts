import { useAppStore } from '@/store'
import { branchName } from '@/lib/git-utils'

/** What the ledger keys a run by. Both Alicorn panels read the same one, so they cannot disagree. */
export type LedgerBranchTarget = { repoId: string; branch: string }

function activeWorktree(state: ReturnType<typeof useAppStore.getState>) {
  return state.activeWorktreeId
    ? (state.getKnownWorktreeById(
        state.activeWorktreeId,
        state.activeWorkspaceExecutionHostId ?? undefined
      ) ?? null)
    : null
}

/**
 * Null when the workspace has no branch to key the ledger by — a detached HEAD and a folder
 * workspace both land there, and neither is the same as "nothing was recorded".
 */
export function useLedgerBranchTarget(): LedgerBranchTarget | null {
  // Two primitive selectors rather than one worktree selector: the store hands back a fresh object
  // on some paths, and subscribing to it re-renders the panel on every unrelated bump.
  const repoId = useAppStore((s) => activeWorktree(s)?.repoId ?? null)
  const branchRef = useAppStore((s) => activeWorktree(s)?.branch ?? null)
  const branch = branchRef ? branchName(branchRef).trim() : ''
  return repoId && branch ? { repoId, branch } : null
}
