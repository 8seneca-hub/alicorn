/**
 * The band above a task's session: what the ticket is, and what it is costing.
 *
 * Everything here is a fact about the run rather than a control for it, with one exception —
 * escalation, which belongs next to the meter that justifies it. PROJECT-BRIEF §04: the offer is
 * made per task and is never applied silently, so it is a button a human presses.
 */
import React from 'react'
import { Check, Circle, DollarSign, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import type { Task } from '../../../../../shared/alicorn/tasks'
import { taskRef } from '../../../../../shared/alicorn/tasks'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'
import type { Member } from '../../../../../shared/alicorn/members'
import { AlicornCrumbs, type AlicornCrumb } from './AlicornScreenChrome'

/** Done / current / still to come, from the stage's position relative to the task's. */
function stageState(
  stages: readonly WorkflowStage[],
  stageKey: string | null,
  stage: WorkflowStage
): 'done' | 'current' | 'todo' {
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
  stageKey
}: {
  stages: readonly WorkflowStage[]
  stageKey: string | null
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5">
      {stages.map((stage, index) => {
        const state = stageState(stages, stageKey, stage)
        return (
          <React.Fragment key={stage.key}>
            {index > 0 ? <span className="mx-1.5 h-px w-4 shrink-0 bg-border" /> : null}
            <span
              className={cn(
                'flex items-center gap-1.5 text-[13px]',
                state === 'current'
                  ? 'font-semibold text-foreground'
                  : state === 'done'
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/70'
              )}
            >
              {state === 'done' ? (
                <Check className="size-3.5 shrink-0" />
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

function MemberChip({ member }: { member: Member }): React.JSX.Element {
  const initials = member.name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border border-border px-2.5 py-1 text-[12px]">
      <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[10px] font-semibold">
        {initials}
      </span>
      <span className="truncate font-medium">{member.name}</span>
      <span className="size-1.5 shrink-0 rounded-full bg-status-running" />
      <span className="truncate text-[11px] text-muted-foreground">{member.backend}</span>
    </span>
  )
}

export function AlicornTaskHeader({
  task,
  projectKey,
  crumbs,
  stages,
  members,
  spentUsd,
  budgetUsd,
  onBack,
  onEscalate
}: {
  task: Task
  projectKey: string
  crumbs: AlicornCrumb[]
  stages: readonly WorkflowStage[]
  members: readonly Member[]
  /** Null while nothing has been priced — never a guessed zero. */
  spentUsd: number | null
  budgetUsd: number | null
  onBack: () => void
  onEscalate?: () => void
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
          <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
            {task.executionStrategy === 'orchestrated' ? <Share2 className="size-3" /> : null}
            {task.executionStrategy}
          </span>
          {spentUsd !== null ? (
            <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground tabular-nums">
              <DollarSign className="size-3" />
              {budgetUsd !== null
                ? `${spentUsd.toFixed(2)} / ${budgetUsd.toFixed(2)}`
                : spentUsd.toFixed(2)}
            </span>
          ) : null}
          {onEscalate && task.executionStrategy === 'single' ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onEscalate}>
              <Share2 className="size-3" />
              {translate('auto.components.alicorn.task.escalate', 'Escalate…')}
            </Button>
          ) : null}
        </div>
      </div>

      {stages.length > 0 || members.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-9 pb-3">
          <StageRail stages={stages} stageKey={task.stageKey} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {members.map((member) => (
              <MemberChip key={member.id} member={member} />
            ))}
          </div>
        </div>
      ) : null}
    </header>
  )
}
