export type RunCostByDispatch = Record<
  string,
  { costUsd: number | null; status: 'known' | 'unavailable' | 'pending' }
>

export function formatRunCostUsd(costUsd: number | null): string {
  if (costUsd === null) {
    return '—'
  }
  if (costUsd < 0.01) {
    return '<$0.01'
  }
  return `$${costUsd.toFixed(2)}`
}

// D7's own event constant — deliberately not ALICORN_EVENTS, which B3 owns.
export const ALICORN_RUN_COST_EVENT = 'alicorn:runCost'
