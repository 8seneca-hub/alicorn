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

export type RunCostSummary = {
  /** Sum of the dispatches we have a figure for; null when we have none at all. */
  costUsd: number | null
  /** A dispatch has run whose cost we cannot state, so the total is a floor, not a figure. */
  partial: boolean
}

/**
 * Sums a run's dispatches. A dispatch priced `unavailable` (a backend Alicorn does not price) or
 * `pending` (not scanned yet) makes the total a floor rather than a figure — CLAUDE.md's token
 * efficiency pillar wants the meter visible, and its cost-attribution rule wants a dash over a
 * guess. Both hold at once by showing what is known and admitting it is incomplete.
 *
 * A node with no dispatch has not run, so it is neither cost nor cause for partial.
 */
export function summarizeRunCost(
  costs: RunCostByDispatch,
  dispatchIds: readonly (string | null | undefined)[]
): RunCostSummary {
  let total = 0
  let known = 0
  let partial = false
  for (const dispatchId of dispatchIds) {
    if (!dispatchId) {
      continue
    }
    const entry = costs[dispatchId]
    if (entry?.status === 'known' && entry.costUsd !== null) {
      total += entry.costUsd
      known += 1
      continue
    }
    // Includes a dispatch the store has never mentioned: silence is not zero.
    partial = true
  }
  return { costUsd: known > 0 ? total : null, partial }
}

/** `≥` and `(partial)` are the whole point: a floor must never read as a total. */
export function formatRunCostSummary(summary: RunCostSummary): string {
  if (summary.costUsd === null) {
    return '—'
  }
  const formatted = formatRunCostUsd(summary.costUsd)
  return summary.partial ? `≥ ${formatted} (partial)` : formatted
}
