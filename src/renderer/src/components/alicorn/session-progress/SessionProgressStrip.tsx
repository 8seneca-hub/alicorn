/**
 * The prototype's session header, over a real session.
 *
 * Everything shown is a record of something that settled: the stages the run has reached, who was
 * on them, what the checks said, and what it has cost. Nothing is predicted — a workflow's
 * remaining stages are deliberately absent, because drawing them would claim work that has not
 * happened.
 *
 * It renders nothing at all until a run exists, so a fresh session opens on the conversation
 * rather than on an empty frame of chrome.
 */
import React from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatRunCostUsd } from '../../../../../shared/alicorn/run-cost'
import { useSessionProgress } from './use-session-progress'

export function SessionProgressStrip({
  isVisible = true
}: {
  isVisible?: boolean
}): React.JSX.Element | null {
  const { progress, cost, hasRun } = useSessionProgress({ isVisible })
  if (!hasRun) {
    return null
  }

  return (
    <div
      data-testid="session-progress-strip"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/20 px-3 py-1.5 text-[11px]"
    >
      <ol className="flex flex-wrap items-center gap-1">
        {progress.stages.map((stage, index) => (
          <li key={stage.stageKey} className="flex items-center gap-1">
            {index > 0 ? <span className="text-muted-foreground/50">›</span> : null}
            <span
              className={cn(
                'capitalize',
                stage.failed
                  ? 'text-destructive'
                  : stage.state === 'current'
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground'
              )}
            >
              {stage.stageKey}
            </span>
          </li>
        ))}
      </ol>

      {progress.members.length > 0 ? (
        <span className="text-muted-foreground">
          {progress.members
            .map((member) => `${member.member} · ${member.backend}`)
            .join(translate('auto.components.alicorn.sessionProgress.memberSeparator', ' → '))}
        </span>
      ) : null}

      {progress.checksPassed > 0 || progress.checksFailed > 0 ? (
        <span className="flex items-center gap-1.5">
          {progress.checksPassed > 0 ? (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <Check className="size-3" aria-hidden />
              {progress.checksPassed}
            </span>
          ) : null}
          {progress.checksFailed > 0 ? (
            <span className="flex items-center gap-0.5 text-destructive">
              <X className="size-3" aria-hidden />
              {progress.checksFailed}
            </span>
          ) : null}
          <span className="sr-only">
            {translate('auto.components.alicorn.sessionProgress.checks', 'required checks')}
          </span>
        </span>
      ) : null}

      <span className="ml-auto text-muted-foreground tabular-nums">
        {formatRunCostUsd(cost.costUsd)}
        {cost.partial ? (
          <span
            title={translate(
              'auto.components.alicorn.sessionProgress.partialCost',
              'A dispatch ran on a backend this build does not price, so the total is a floor.'
            )}
          >
            +
          </span>
        ) : null}
      </span>
    </div>
  )
}
