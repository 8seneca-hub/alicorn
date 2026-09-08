import { useCallback, useEffect, useState } from 'react'
import type { PendingGateView } from '../../../../../shared/alicorn/gate-review'

/**
 * Slower than a frame, faster than the ledger poll: a gate is opened by a settling dispatch, and
 * the store it is read from is local, so the cost of asking is a SQLite read rather than a
 * round trip to the control plane.
 */
export const GATE_POLL_MS = 5_000

export type GatePanelState = {
  /** Null while the first read is in flight; an empty array means nothing is waiting. */
  gates: PendingGateView[] | null
  error: string | null
  refresh: () => void
}

export function useGatePanelState({ isVisible }: { isVisible: boolean }): GatePanelState {
  const [gates, setGates] = useState<PendingGateView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const refresh = useCallback(() => setRefreshCount((count) => count + 1), [])

  useEffect(() => {
    if (!isVisible) {
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      // Why optional: a render surface under test may not install window.api — degrade to
      // "nothing waiting" rather than throw, matching the provenance panel's reasoning.
      const read = window.api?.alicorn?.listPendingGates
      if (!read) {
        return
      }
      const result = await read()
      if (cancelled) {
        return
      }
      if (result.ok) {
        setGates(result.gates)
        setError(null)
      } else {
        setError(result.error)
      }
    }
    void load()
    const timer = setInterval(() => void load(), GATE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isVisible, refreshCount])

  return { gates, error, refresh }
}
