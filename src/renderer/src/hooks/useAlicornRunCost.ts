import { useSyncExternalStore } from 'react'
import type { RunCostByDispatch } from '../../../shared/alicorn/run-cost'
import { getAlicornRunCostSnapshot, subscribeAlicornRunCost } from '../store/alicorn-run-cost-store'

/** The whole payload, for a surface that rolls many dispatches up rather than reading one. */
export function useRunCostByDispatch(): RunCostByDispatch {
  return useSyncExternalStore(
    subscribeAlicornRunCost,
    getAlicornRunCostSnapshot,
    getAlicornRunCostSnapshot
  )
}

export function useDispatchCost(
  dispatchId: string | undefined
): RunCostByDispatch[string] | undefined {
  const payload = useSyncExternalStore(
    subscribeAlicornRunCost,
    getAlicornRunCostSnapshot,
    getAlicornRunCostSnapshot
  )
  return dispatchId ? payload[dispatchId] : undefined
}
