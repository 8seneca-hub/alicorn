import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ForemanRunViewResult } from '../../../../../shared/alicorn/foreman-run'
import { summarizeRunCost, type RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import { getAlicornRunCostSnapshot, subscribeAlicornRunCost } from '@/store/alicorn-run-cost-store'
import { useAppStore } from '@/store'

/** Slow on purpose: a journal changes when a node is dispatched, not every frame. */
export const RUN_VIEW_POLL_MS = 4_000

export type RunViewState = {
  result: ForemanRunViewResult | null
  cost: RunCostSummary
  refresh: () => void
}

export function useRunViewState({ isVisible }: { isVisible: boolean }): RunViewState {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const [result, setResult] = useState<ForemanRunViewResult | null>(null)
  const costs = useSyncExternalStore(
    subscribeAlicornRunCost,
    getAlicornRunCostSnapshot,
    getAlicornRunCostSnapshot
  )

  const read = useCallback(async (): Promise<ForemanRunViewResult> => {
    // Why optional: a render surface under test may not install window.api — degrade to "no run"
    // rather than throw, matching the run-cost store's reasoning.
    if (!worktreeId || !window.api?.alicorn?.getForemanRun) {
      return { state: 'none' }
    }
    return window.api.alicorn.getForemanRun(worktreeId)
  }, [worktreeId])

  const [refreshCount, setRefreshCount] = useState(0)
  const refresh = useCallback(() => setRefreshCount((count) => count + 1), [])

  useEffect(() => {
    if (!isVisible) {
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
    // Why polling stops with the panel: the journal is only interesting while someone is watching,
    // and a closed panel must not keep reading a workspace off an SSH host every few seconds.
    const timer = setInterval(() => void load(), RUN_VIEW_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isVisible, read, refreshCount])

  // Reset when the workspace changes so the previous run's plan never shows under a new workspace.
  useEffect(() => {
    setResult(null)
  }, [worktreeId])

  const plan = result?.state === 'ready' ? result.run.plan : []
  return {
    result,
    cost: summarizeRunCost(
      costs,
      plan.map((node) => node.dispatchId)
    ),
    refresh
  }
}
