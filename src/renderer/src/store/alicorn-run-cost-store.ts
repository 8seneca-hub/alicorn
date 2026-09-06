import type { RunCostByDispatch } from '../../../shared/alicorn/run-cost'

const EMPTY_PAYLOAD: RunCostByDispatch = {}
let payload: RunCostByDispatch = EMPTY_PAYLOAD
const subscribers = new Set<() => void>()
let unsubscribeIpc: (() => void) | null = null

function handlePayload(next: RunCostByDispatch): void {
  payload = next
  for (const subscriber of subscribers) {
    subscriber()
  }
}

// Why: one `onChanged` listener for the whole renderer regardless of how many
// agent rows read it, matching useSkillFreshness's shared-subscription idiom.
export function subscribeAlicornRunCost(subscriber: () => void): () => void {
  subscribers.add(subscriber)
  // Why optional: a render surface under test may not install window.api at all
  // (unlike the packaged app and the web client's fallback proxy, both of which
  // always have it) — degrade to "no cost data" rather than throw.
  if (!unsubscribeIpc && window.api?.alicornRunCost) {
    unsubscribeIpc = window.api.alicornRunCost.onChanged(handlePayload)
  }
  // Why never torn down on the last unsubscribe: a payload published while no row
  // is mounted (e.g. between agent rows re-rendering) must not be lost between
  // the last unsubscribe and the next subscribe — kept for the app's lifetime.
  return () => {
    subscribers.delete(subscriber)
  }
}

export function getAlicornRunCostSnapshot(): RunCostByDispatch {
  return payload
}
