/**
 * What a project has spent: its worktrees' dispatches, summed through D7's own `summarizeRunCost`.
 *
 * Attribution is deliberately the union of two routes to the same worktree. Main stamps
 * `worktreeId` on an entry when the reporting hook resolved there, which covers an orchestration
 * worker whose tab does not exist in this renderer yet; a local pane often has no stamp, and is
 * reached through its tab instead. Either alone undercounts, and an undercounted meter reads as a
 * figure rather than the floor it is.
 */
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import {
  summarizeRunCost,
  type RunCostByDispatch,
  type RunCostSummary
} from '../../../../../shared/alicorn/run-cost'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { parseAgentStatusPaneKey } from '../../tab-bar/terminal-tab-activity-status'

export function summarizeProjectRunCost({
  worktreeIds,
  tabsByWorktree,
  agentStatusByPaneKey,
  costs
}: {
  worktreeIds: readonly string[]
  tabsByWorktree: Record<string, TerminalTab[]>
  agentStatusByPaneKey: Record<string, AgentStatusEntry> | undefined
  costs: RunCostByDispatch
}): RunCostSummary {
  const worktrees = new Set(worktreeIds)
  const tabIds = new Set<string>()
  for (const worktreeId of worktrees) {
    for (const tab of tabsByWorktree[worktreeId] ?? []) {
      tabIds.add(tab.id)
    }
  }
  // Why a set: two panes of one session can report the same dispatch, and counting it twice
  // doubles the meter.
  const dispatchIds = new Set<string>()
  for (const [paneKey, entry] of Object.entries(agentStatusByPaneKey ?? {})) {
    const dispatchId = entry.orchestration?.dispatchId
    if (!dispatchId) {
      continue
    }
    const tabId = entry.tabId ?? parseAgentStatusPaneKey(entry.paneKey || paneKey)?.tabId
    if ((entry.worktreeId && worktrees.has(entry.worktreeId)) || (tabId && tabIds.has(tabId))) {
      dispatchIds.add(dispatchId)
    }
  }
  return summarizeRunCost(costs, [...dispatchIds])
}

/**
 * One figure across several projects. A project with nothing to state contributes nothing — not a
 * zero, and not a `partial`, because silence about a project that never ran is not missing data.
 */
export function mergeRunCostSummaries(summaries: readonly RunCostSummary[]): RunCostSummary {
  let total = 0
  let known = false
  let partial = false
  for (const summary of summaries) {
    if (summary.costUsd !== null) {
      total += summary.costUsd
      known = true
    }
    partial = partial || summary.partial
  }
  return { costUsd: known ? total : null, partial }
}
