/**
 * The session's own progress, read from the ledger for the workspace the chat is attached to.
 *
 * Polls rather than subscribes for the same reason the provenance panel does: a step settles at
 * dispatch speed, not frame speed, and each read crosses to the control plane. It stops entirely
 * when the surface is not visible — a background tab must not keep reading a workspace every few
 * seconds, least of all one on an SSH host.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { RunInspectorView } from '../../../../../shared/alicorn/run-inspector-view'
import {
  EMPTY_SESSION_PROGRESS,
  summarizeSessionProgress,
  type SessionProgress
} from '../../../../../shared/alicorn/session-progress'
import { summarizeRunCost, type RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import { getAlicornRunCostSnapshot, subscribeAlicornRunCost } from '@/store/alicorn-run-cost-store'
import { useLedgerBranchTarget } from '../../right-sidebar/use-ledger-branch-target'

/** Matches the provenance panel: three control-plane reads per poll is not a per-second cost. */
export const SESSION_PROGRESS_POLL_MS = 15_000

export type SessionProgressState = {
  progress: SessionProgress
  /** Live spend for the dispatches this run knows about; a floor when a backend is unpriced. */
  cost: RunCostSummary
  /** False until the first read lands, so the strip can stay out of the way until it has something. */
  hasRun: boolean
}

export function useSessionProgress({ isVisible }: { isVisible: boolean }): SessionProgressState {
  const target = useLedgerBranchTarget()
  const repoId = target?.repoId ?? null
  const branch = target?.branch ?? null
  const [view, setView] = useState<RunInspectorView | null>(null)
  const costs = useSyncExternalStore(
    subscribeAlicornRunCost,
    getAlicornRunCostSnapshot,
    getAlicornRunCostSnapshot
  )

  const read = useCallback(async (): Promise<RunInspectorView | null> => {
    // Why optional: a render surface under test may not install window.api — degrade to "no run"
    // rather than throw, matching the run view's reasoning.
    if (!repoId || !branch || !window.api?.alicorn?.getRunInspector) {
      return null
    }
    const result = await window.api.alicorn.getRunInspector({ repoId, branch })
    return result.ok ? result.view : null
  }, [repoId, branch])

  useEffect(() => {
    if (!isVisible) {
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      const next = await read()
      if (!cancelled) {
        setView(next)
      }
    }
    void load()
    const timer = setInterval(() => void load(), SESSION_PROGRESS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isVisible, read])

  const dispatches = view?.dispatches ?? []
  return {
    progress: dispatches.length > 0 ? summarizeSessionProgress(dispatches) : EMPTY_SESSION_PROGRESS,
    // Live from the cost store rather than the polled view, so the meter moves between polls.
    cost: summarizeRunCost(
      costs,
      dispatches.map((dispatch) => dispatch.dispatchId)
    ),
    hasRun: dispatches.length > 0
  }
}
