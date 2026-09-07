import {
  summarizeRunCost,
  type RunCostByDispatch,
  type RunCostSummary
} from '../../../../shared/alicorn/run-cost'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { parseAgentStatusPaneKey } from './terminal-tab-activity-status'

type TerminalTabRunCostInput = {
  tabId: string
  agentStatusByPaneKey?: Record<string, AgentStatusEntry>
  costs: RunCostByDispatch
}

/**
 * A tab's running spend: the dispatches of its panes, summed through D7's own
 * `summarizeRunCost` so the tab shows the same floor-vs-figure distinction as the
 * sidebar agent row and the Foreman run view. Panes are bucketed by tab exactly as
 * the status dot buckets them (resolveTerminalTabActivityStatus).
 */
export function resolveTerminalTabRunCost({
  tabId,
  agentStatusByPaneKey,
  costs
}: TerminalTabRunCostInput): RunCostSummary {
  // Why a set: two panes of one tab can report the same dispatch; counting it twice doubles the meter.
  const dispatchIds = new Set<string>()
  for (const [paneKey, entry] of Object.entries(agentStatusByPaneKey ?? {})) {
    const dispatchId = entry.orchestration?.dispatchId
    if (!dispatchId) {
      continue
    }
    if (parseAgentStatusPaneKey(entry.paneKey || paneKey)?.tabId === tabId) {
      dispatchIds.add(dispatchId)
    }
  }
  return summarizeRunCost(costs, [...dispatchIds])
}
