/**
 * What one task has cost so far.
 *
 * The same sum the sidebar shows a project, over a narrower set of worktrees: a task's are the ones
 * it is bound to. Tier 1 §6 wants the meter visible while working rather than in a report nobody
 * opens, and the header is where the task is already being watched.
 *
 * Null when nothing has been priced — never a guessed zero. A backend Alicorn does not price makes
 * the figure a floor, which `RunCostSummary.partial` carries and the header shows as `≥`.
 */
import React from 'react'
import { useRunCostByDispatch } from '@/hooks/useAlicornRunCost'
import { useAppStore } from '@/store'
import type { TaskWorktreeTuple } from '../../../../../shared/alicorn/feature-workspace-tuples'
import type { RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import { summarizeWorktreeRunCost } from './worktree-run-cost'

export function useTaskRunCost(tuples: readonly TaskWorktreeTuple[]): RunCostSummary {
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((state) => state.agentStatusByPaneKey)
  const costs = useRunCostByDispatch()
  const worktreeIds = tuples.map((tuple) => tuple.worktreeId)
  const key = worktreeIds.join(',')

  return React.useMemo(
    () =>
      summarizeWorktreeRunCost({
        worktreeIds: key ? key.split(',') : [],
        tabsByWorktree,
        agentStatusByPaneKey,
        costs
      }),
    [key, tabsByWorktree, agentStatusByPaneKey, costs]
  )
}
