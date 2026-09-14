/**
 * The band above a task's session: what the ticket is, and what it is costing.
 *
 * Everything here is a fact about the run rather than a control for it, with one exception — how
 * the task runs, which belongs next to the meter that justifies it. PROJECT-BRIEF §04: the choice
 * is made per task and is never applied silently, so it is a menu a human opens.
 */
import React from 'react'
import { Check, ChevronDown, Circle, DollarSign, Minus, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { formatRunCostSummary, type RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import type { Task } from '../../../../../shared/alicorn/tasks'
import { taskRef } from '../../../../../shared/alicorn/tasks'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'
import { AlicornCrumbs, type AlicornCrumb } from './AlicornScreenChrome'

/**
 * How a task runs, as the two axes PROJECT-BRIEF §04 settles on — never a third "mode".
 *
 * `single` genuinely stays the default; orchestrated costs roughly an order of magnitude more, so
 * the menu says the price rather than leaving it to be discovered on the meter.
 */
const EXECUTION_STRATEGIES: readonly {
  value: Task['executionStrategy']
  title: string
  detail: string
}[] = [
  {
    value: 'single',
    title: translate('auto.components.alicorn.task.strategySingle', 'One agent'),
    detail: translate(
      'auto.components.alicorn.task.strategySingleDetail',
      'One session works the whole ticket. The default, and right for most work.'
    )
  },
  {
    value: 'orchestrated',
    title: translate('auto.components.alicorn.task.strategyOrchestrated', 'A lead and subagents'),
    detail: translate(
      'auto.components.alicorn.task.strategyOrchestratedDetail',
      'A lead splits the ticket and dispatches subagents. Roughly 10–15× the tokens — worth it for long or multi-repo work.'
    )
  }
]

/**
 * Which stage a task is at.
 *
 * `stageKey` is written by a workflow dispatching the task, and nothing dispatches yet — so it is
 * null on every task today and the rail would read as "nothing has started" forever. The stage
 * already names the board column that dispatches it, so the column answers the same question with
 * the data that exists. An explicit `stageKey` still wins: once something writes one, it is the
 * authority and this fallback stops being consulted.
 */
export function resolveTaskStageKey(
  stages: readonly WorkflowStage[],
  task: Pick<Task, 'stageKey' | 'column'>
): string | null {
  if (task.stageKey) {
    return task.stageKey
  }
  // Last match, not first: several stages may share a column (Spec and Architecture both sit in
  // todo), and the furthest one is the honest reading of "how far this has got".
  const matching = stages.filter((stage) => stage.columnId === task.column)
  return matching.at(-1)?.key ?? null
}

/** Done / current / still to come / not needed, from the stage's position relative to the task's. */
function stageState(
  stages: readonly WorkflowStage[],
  stageKey: string | null,
  stage: WorkflowStage,
  skipped: readonly string[]
): 'done' | 'current' | 'todo' | 'skipped' {
  if (skipped.includes(stage.key)) {
    return 'skipped'
  }
  if (!stageKey) {
    return 'todo'
  }
  if (stage.key === stageKey) {
    return 'current'
  }
  const current = stages.findIndex((candidate) => candidate.key === stageKey)
  const mine = stages.findIndex((candidate) => candidate.key === stage.key)
  return current !== -1 && mine !== -1 && mine < current ? 'done' : 'todo'
}

function StageRail({
  stages,
  stageKey,
  skipped
}: {
  stages: readonly WorkflowStage[]
  stageKey: string | null
  /** Struck through: this task does not need them, so they are not a position it can be at. */
  skipped: readonly string[]
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5">
      {stages.map((stage, index) => {
        const state = stageState(stages, stageKey, stage, skipped)
        return (
          <React.Fragment key={stage.key}>
            {index > 0 ? <span className="mx-1.5 h-px w-4 shrink-0 bg-border" /> : null}
            <span
              title={
                state === 'skipped'
                  ? translate(
                      'auto.components.alicorn.task.stageSkipped',
                      'This task does not need {{stage}}',
                      { stage: stage.name }
                    )
                  : undefined
              }
              className={cn(
                'flex items-center gap-1.5 text-[13px]',
                state === 'current'
                  ? 'font-semibold text-foreground'
                  : state === 'done'
                    ? 'text-muted-foreground'
                    : state === 'skipped'
                      ? 'text-muted-foreground/50 line-through decoration-muted-foreground/60'
                      : 'text-muted-foreground/70'
              )}
            >
              {state === 'done' ? (
                <Check className="size-3.5 shrink-0" />
              ) : state === 'skipped' ? (
                <Minus className="size-3.5 shrink-0" />
              ) : (
                <Circle
                  className={cn('size-3.5 shrink-0', state === 'current' && 'stroke-[2.5]')}
                />
              )}
              {stage.name}
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}

export function AlicornTaskHeader({
  task,
  projectKey,
  crumbs,
  stages,
  cost,
  onBack,
  onStrategyChange
}: {
  task: Task
  projectKey: string
  crumbs: AlicornCrumb[]
  stages: readonly WorkflowStage[]
  /**
   * What this task has cost. A null total means nothing has been priced — never a guessed zero —
   * and `partial` means the figure is a floor, which the shared formatter writes as `≥`.
   */
  cost: RunCostSummary
  onBack: () => void
  /** Changes how the task runs. Absent when the caller cannot write the task. */
  onStrategyChange?: (strategy: Task['executionStrategy']) => void
}): React.JSX.Element {
  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex items-start gap-3 px-9 pb-3.5 pt-4">
        <div className="min-w-0 flex-1">
          <AlicornCrumbs crumbs={crumbs} onBack={onBack} />
          <h1 className="mt-0.5 flex min-w-0 items-baseline gap-2.5 text-[17px]">
            <span className="shrink-0 font-semibold">{taskRef(projectKey, task.number)}</span>
            <span className="truncate font-normal">{task.title}</span>
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The chip is the control. "Escalate…" was a separate button whose label named an
              outcome rather than the thing it changed, and it could only go one way — so the
              setting was readable in one place and changeable in another. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={!onStrategyChange}>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-accent disabled:pointer-events-none"
              >
                {task.executionStrategy === 'orchestrated' ? <Share2 className="size-3" /> : null}
                {task.executionStrategy}
                {onStrategyChange ? <ChevronDown className="size-3" /> : null}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[280px]">
              {EXECUTION_STRATEGIES.map((strategy) => (
                <DropdownMenuItem
                  key={strategy.value}
                  onSelect={() => onStrategyChange?.(strategy.value)}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="flex w-full items-center gap-1.5 font-medium">
                    {strategy.value === task.executionStrategy ? (
                      <Check className="size-3" />
                    ) : (
                      <span className="size-3" />
                    )}
                    {strategy.title}
                  </span>
                  <span className="pl-[18px] text-[11px] text-muted-foreground">
                    {strategy.detail}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {cost.costUsd !== null ? (
            <span
              className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground tabular-nums"
              title={translate(
                'auto.components.alicorn.task.spendTitle',
                'What this task has cost so far, summed over the dispatches on its worktrees.'
              )}
            >
              <DollarSign className="size-3" />
              {formatRunCostSummary(cost)}
            </span>
          ) : null}
        </div>
      </div>

      {stages.length > 0 ? (
        <div className="px-9 pb-3">
          <StageRail
            stages={stages}
            stageKey={resolveTaskStageKey(stages, task)}
            skipped={task.skippedStageKeys}
          />
        </div>
      ) : null}
    </header>
  )
}
