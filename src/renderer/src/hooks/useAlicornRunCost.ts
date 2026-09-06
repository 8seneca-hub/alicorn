import { useSyncExternalStore } from 'react'
import type { RunCostByDispatch } from '../../../shared/alicorn/run-cost'
import { getAlicornRunCostSnapshot, subscribeAlicornRunCost } from '../store/alicorn-run-cost-store'

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
