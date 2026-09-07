import React, { useSyncExternalStore } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getAlicornRunCostSnapshot, subscribeAlicornRunCost } from '@/store/alicorn-run-cost-store'
import { formatRunCostSummary } from '../../../../shared/alicorn/run-cost'
import { resolveTerminalTabRunCost } from './terminal-tab-run-cost'

/**
 * Running spend for one tab, on the tab. CLAUDE.md's token-efficiency pillar wants the
 * meter visible while the work runs, not in a report nobody opens. Absent for a tab that
 * has never dispatched — a dash on every ordinary shell tab is noise, not information.
 */
export function TabRunCostBadge({ tabId }: { tabId: string }): React.JSX.Element | null {
  const costs = useSyncExternalStore(
    subscribeAlicornRunCost,
    getAlicornRunCostSnapshot,
    getAlicornRunCostSnapshot
  )
  // Why a string, not the summary object: zustand compares with Object.is, so returning a
  // fresh object would repaint this tab on every unrelated store write.
  const label = useAppStore((s) => {
    const summary = resolveTerminalTabRunCost({
      tabId,
      agentStatusByPaneKey: s.agentStatusByPaneKey,
      costs
    })
    return summary.costUsd === null && !summary.partial ? null : formatRunCostSummary(summary)
  })
  if (label === null) {
    return null
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="mr-1 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70"
          data-testid="tab-run-cost"
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {translate(
          'auto.components.tab.bar.TabRunCostBadge.estimatedSpend',
          'Estimated spend for this tab (API-equivalent)'
        )}
      </TooltipContent>
    </Tooltip>
  )
}
