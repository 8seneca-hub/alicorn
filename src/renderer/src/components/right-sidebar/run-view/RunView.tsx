import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatRunCostSummary, type RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import type { ForemanPlanNode, ForemanRunView } from '../../../../../shared/alicorn/foreman-run'
import { NODE_COLOR, NODE_ICON, RUN_STATUS_COLOR } from './run-node-presentation'
import { useRunViewState } from './use-run-view-state'
import { translate } from '@/i18n/i18n'

export function RunView({ isVisible = true }: { isVisible?: boolean }): React.JSX.Element {
  const { result, cost } = useRunViewState({ isVisible })

  if (result === null) {
    return (
      <RunViewNotice
        text={translate(
          'auto.components.right.sidebar.run.view.RunView.0f073d39b4',
          'Reading the journal…'
        )}
      />
    )
  }
  if (result.state === 'none') {
    return (
      <RunViewNotice
        text={translate(
          'auto.components.right.sidebar.run.view.RunView.ef8d79cafd',
          'No orchestrated run in this workspace. A task dispatched with a Foreman lead keeps its journal here.'
        )}
      />
    )
  }
  if (result.state === 'unreadable') {
    return (
      <RunViewNotice
        text={translate(
          'auto.components.right.sidebar.run.view.RunView.94c2aaf9a8',
          'This run’s journal could not be read.'
        )}
        detail={result.reason}
      />
    )
  }
  return <RunViewBody run={result.run} cost={cost} />
}

function RunViewBody({
  run,
  cost
}: {
  run: ForemanRunView
  cost: RunCostSummary
}): React.JSX.Element {
  return (
    <div className="scrollbar-sleek flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn('shrink-0 capitalize', RUN_STATUS_COLOR[run.status])}
          >
            {run.status}
          </Badge>
          <span className="truncate font-mono text-[10px] text-muted-foreground">{run.runId}</span>
          <CostMeter cost={cost} budgetCents={run.budgetCents} />
        </div>
        <p className="text-xs leading-snug text-foreground">{run.objective}</p>
      </div>
      {run.plan.length === 0 ? (
        <RunViewNotice
          text={translate(
            'auto.components.right.sidebar.run.view.RunView.2ddfeaf3ad',
            'The lead has not planned yet.'
          )}
        />
      ) : (
        <ul className="flex flex-col" data-testid="run-view-plan">
          {run.plan.map((node) => (
            <PlanNodeRow key={node.id} node={node} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CostMeter({
  cost,
  budgetCents
}: {
  cost: RunCostSummary
  budgetCents: number | null
}): React.JSX.Element {
  const formatted = formatRunCostSummary(cost)
  const budget =
    budgetCents === null ? 'no budget set' : `${'budget'} $${(budgetCents / 100).toFixed(2)}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground"
          data-testid="run-view-cost"
        >
          {formatted}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {cost.partial
          ? translate(
              'auto.components.right.sidebar.run.view.RunView.812f26e81d',
              'A floor, not a total — some dispatches ran on a backend Orca does not price, or have not been measured yet.'
            )
          : translate(
              'auto.components.right.sidebar.run.view.RunView.7cf5a7f9b2',
              'Cost of this run so far.'
            )}{' '}
        {budget}
      </TooltipContent>
    </Tooltip>
  )
}

function PlanNodeRow({ node }: { node: ForemanPlanNode }): React.JSX.Element {
  const Icon = NODE_ICON[node.status]
  return (
    <li className="flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0">
      <Icon
        className={cn(
          'mt-0.5 size-3 shrink-0',
          NODE_COLOR[node.status],
          node.status === 'dispatched' && 'animate-spin'
        )}
        aria-label={node.status}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* The id is what `after 2, 3` refers to; without it on the row, a dependency cannot be
            followed by eye. */}
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{node.id}</span>
          <span className="truncate text-xs text-foreground">{node.title}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
          <span>{node.owner}</span>
          {node.model ? <span className="font-mono">{node.model}</span> : null}
          {node.dependsOn.length > 0 ? (
            <span>
              {translate('auto.components.right.sidebar.run.view.RunView.0276527834', 'after')}{' '}
              {node.dependsOn.join(', ')}
            </span>
          ) : null}
        </span>
      </div>
    </li>
  )
}

function RunViewNotice({ text, detail }: { text: string; detail?: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 px-3 py-4 text-xs text-muted-foreground">
      <p>{text}</p>
      {detail ? <p className="font-mono text-[10px] break-words">{detail}</p> : null}
    </div>
  )
}
