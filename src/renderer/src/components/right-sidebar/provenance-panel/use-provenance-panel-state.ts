import { useCallback, useEffect, useState } from 'react'
import type { ProvenanceViewResult } from '../../../../../shared/alicorn/provenance-view'
import { useLedgerBranchTarget, type LedgerBranchTarget } from '../use-ledger-branch-target'

/**
 * Slow on purpose, and slower than the run journal's: each poll is three reads against the control
 * plane, and a step settles at dispatch speed rather than frame speed.
 */
export const PROVENANCE_POLL_MS = 15_000

export type ProvenanceTarget = LedgerBranchTarget

export type ProvenancePanelState = {
  /** Null while the first read of the current target is still in flight. */
  result: ProvenanceViewResult | null
  /** What the panel is reading; null when the workspace has no branch to key the ledger by. */
  target: ProvenanceTarget | null
  refresh: () => void
}

export function useProvenancePanelState({
  isVisible
}: {
  isVisible: boolean
}): ProvenancePanelState {
  const target = useLedgerBranchTarget()
  const repoId = target?.repoId ?? null
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
