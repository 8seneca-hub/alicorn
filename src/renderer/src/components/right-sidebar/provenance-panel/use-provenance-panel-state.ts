import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { branchName } from '@/lib/git-utils'
import type { ProvenanceViewResult } from '../../../../../shared/alicorn/provenance-view'

/**
 * Slow on purpose, and slower than the run journal's: each poll is three reads against the control
 * plane, and a step settles at dispatch speed rather than frame speed.
 */
export const PROVENANCE_POLL_MS = 15_000

export type ProvenanceTarget = { repoId: string; branch: string }

export type ProvenancePanelState = {
  /** Null while the first read of the current target is still in flight. */
  result: ProvenanceViewResult | null
  /** What the panel is reading; null when the workspace has no branch to key the ledger by. */
  target: ProvenanceTarget | null
  refresh: () => void
}

function activeTarget(
  repoId: string | undefined,
  branch: string | undefined
): ProvenanceTarget | null {
  const resolved = branch ? branchName(branch).trim() : ''
  // A detached HEAD and a folder workspace both land here: the ledger keys a run by repo *and*
  // branch, so with no branch there is nothing to ask for — which is not the same as no record.
  return repoId && resolved ? { repoId, branch: resolved } : null
}

function activeWorktree(state: ReturnType<typeof useAppStore.getState>) {
  return state.activeWorktreeId
    ? (state.getKnownWorktreeById(
        state.activeWorktreeId,
        state.activeWorkspaceExecutionHostId ?? undefined
      ) ?? null)
    : null
}

export function useProvenancePanelState({
  isVisible
}: {
  isVisible: boolean
}): ProvenancePanelState {
  // Two primitive selectors rather than one worktree selector: the store hands back a fresh
  // object on some paths, and subscribing to it re-renders this panel on every unrelated bump.
  const repoId = useAppStore((s) => activeWorktree(s)?.repoId ?? null)
  const branchRef = useAppStore((s) => activeWorktree(s)?.branch ?? null)
  const target = activeTarget(repoId ?? undefined, branchRef ?? undefined)
  const branch = target?.branch ?? null

  const [result, setResult] = useState<ProvenanceViewResult | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const refresh = useCallback(() => setRefreshCount((count) => count + 1), [])

  const read = useCallback(async (): Promise<ProvenanceViewResult | null> => {
    // Why optional: a render surface under test may not install window.api — degrade to "nothing
    // to read" rather than throw, matching the run view's reasoning.
    if (!repoId || !branch || !window.api?.alicorn?.getProvenance) {
      return null
    }
    return window.api.alicorn.getProvenance({ repoId, branch })
  }, [repoId, branch])

  // Never show the previous branch's record under a new one, even for a frame.
  useEffect(() => {
    setResult(null)
  }, [repoId, branch])

  useEffect(() => {
    if (!isVisible || !repoId || !branch) {
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      const next = await read()
      if (!cancelled) {
        setResult(next)
      }
    }
    void load()
    // Polling stops with the panel: a closed panel must not keep the control plane busy for a
    // record nobody is reading.
    const timer = setInterval(() => void load(), PROVENANCE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isVisible, read, refreshCount, repoId, branch])

  return { result, target, refresh }
}
