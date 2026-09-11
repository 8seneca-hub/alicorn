import React, { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { GateVerdict, PendingGateView } from '../../../../../shared/alicorn/gate-review'
import { gateReasonSentence } from '../provenance-panel/provenance-gate-copy'
import { isGateDecisionReason } from '../../../../../shared/alicorn/provenance-view'
import { GATE_VERDICT_COLOR, humanVerdictLabel, policyWouldHaveSentence } from './gate-panel-copy'
import { useGatePanelState } from './use-gate-panel-state'
import { groupGatesByRepo } from '../../../../../shared/alicorn/gate-grouping'
import { useAppStore } from '@/store'

/**
 * The level-1 advisory surface (GP3). Every gate still fires — nothing here retires one. What it
 * adds is the policy's recommendation, shown only once the member has reached level 1, and the
 * human's own call on whether the step needed them. Comparing the two is the agreement signal
 * that lets a gate ever be retired later; the recommendation is the means, not the deliverable.
 */
export function GatePanel({ isVisible = true }: { isVisible?: boolean }): React.JSX.Element {
  const { gates, error, refresh } = useGatePanelState({ isVisible })
  const repos = useAppStore((state) => state.repos)
  const repoName = React.useCallback(
    (repoId: string): string => repos.find((repo) => repo.id === repoId)?.displayName ?? repoId,
    [repos]
  )
  // One group renders flat, exactly as before — a header over the only project in the queue is
  // noise, and the common case is one project.
  const groups = React.useMemo(() => groupGatesByRepo(gates ?? [], repoName), [gates, repoName])

  if (error) {
    return (
      <GateNotice
        text={translate(
          'auto.components.right.sidebar.gate.panel.unavailable',
          'Pending gates could not be read.'
        )}
        detail={error}
        onRefresh={refresh}
      />
    )
  }
  if (gates === null) {
    return (
      <GateNotice
        text={translate('auto.components.right.sidebar.gate.panel.loading', 'Reading gates…')}
      />
    )
  }
  if (gates.length === 0) {
    return (
      <GateNotice
        text={translate(
          'auto.components.right.sidebar.gate.panel.empty',
          'No gate is waiting on you. A step that needs a decision will appear here.'
        )}
        onRefresh={refresh}
      />
    )
  }
  return (
    <div className="scrollbar-sleek flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {gates.length}{' '}
          {translate('auto.components.right.sidebar.gate.panel.waiting', 'waiting on you')}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-5 shrink-0"
          onClick={refresh}
          title={translate('auto.components.right.sidebar.gate.panel.refresh', 'Re-read gates')}
        >
          <RefreshCw className="size-3" />
        </Button>
      </div>
      <ul className="flex flex-col" data-testid="pending-gates">
        {groups.map((group) => (
          <React.Fragment key={group.repoId ?? 'unattributed'}>
            {groups.length > 1 ? (
              <li
                className="border-b border-border/60 bg-muted/30 px-3 py-1 text-[11px] font-medium text-muted-foreground"
                data-testid="gate-group-header"
              >
                {group.repoId === null
                  ? translate(
                      'auto.components.right.sidebar.gate.panel.unattributed',
                      'Not attributed to a project'
                    )
                  : repoName(group.repoId)}
              </li>
            ) : null}
            {group.gates.map((gate) => (
              <GateRow key={gate.id} gate={gate} onResolved={refresh} />
            ))}
          </React.Fragment>
        ))}
      </ul>
    </div>
  )
}

function GateRow({
  gate,
  onResolved
}: {
  gate: PendingGateView
  onResolved: () => void
}): React.JSX.Element {
  const [resolution, setResolution] = useState('')
  // No initial value and no default: a recommendation the human accepts by pressing Enter
  // measures the UI, not the policy. Both verdicts start unchosen and stay one click apart.
  const [verdict, setVerdict] = useState<GateVerdict | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const canResolve = resolution.trim().length > 0 && verdict !== null && !busy

  const resolve = async (): Promise<void> => {
    if (!canResolve || verdict === null) {
      return
    }
    setBusy(true)
    setFailure(null)
    const result = await window.api?.alicorn?.resolveGate?.({
      gateId: gate.id,
      resolution: resolution.trim(),
      humanGateDecision: verdict
    })
    setBusy(false)
    if (result && !result.ok) {
      setFailure(result.error)
      return
    }
    onResolved()
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-xs font-medium text-foreground">
          {gate.taskTitle ?? gate.taskId}
        </span>
        {gate.recommendation ? (
          <Badge
            variant="outline"
            className={cn('ml-auto shrink-0', GATE_VERDICT_COLOR[gate.recommendation.decision])}
          >
            {translate('auto.components.right.sidebar.gate.panel.advisory', 'Advisory')}
          </Badge>
        ) : null}
      </span>
      <p className="text-xs leading-snug text-foreground">{gate.question}</p>

      {gate.options.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {gate.options.map((option) => (
            <Button
              key={option}
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setResolution(option)}
            >
              {option}
            </Button>
          ))}
        </span>
      ) : null}

      <Input
        value={resolution}
        onChange={(event) => setResolution(event.target.value)}
        className="h-7 text-xs"
        placeholder={translate(
          'auto.components.right.sidebar.gate.panel.resolution.placeholder',
          'Your answer, sent back to the member'
        )}
        aria-label={translate(
          'auto.components.right.sidebar.gate.panel.resolution.label',
          'Resolution'
        )}
      />

      <PolicyAdvisory gate={gate} />

      <span className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.gate.panel.your.call',
            'Did this step need you?'
          )}
        </span>
        <span className="flex flex-wrap gap-1">
          {/* Order is fixed and never sorted by the recommendation: putting the policy's answer
              under the cursor is the one thing that would make agreement meaningless. */}
          {(['gate', 'auto'] as const).map((candidate) => (
            <Button
              key={candidate}
              variant="outline"
              size="sm"
              aria-pressed={verdict === candidate}
              className={cn(
                'h-6 px-2 text-xs',
                verdict === candidate && 'border-primary text-primary'
              )}
              onClick={() => setVerdict(candidate)}
            >
              {humanVerdictLabel(candidate)}
            </Button>
          ))}
        </span>
      </span>

      <span className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={!canResolve}
          onClick={() => void resolve()}
        >
          {translate('auto.components.right.sidebar.gate.panel.resolve', 'Resolve')}
        </Button>
        {failure ? (
          <span className="font-mono text-[10px] text-rose-500">{failure}</span>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.gate.panel.recorded',
              'Your call is recorded beside the policy’s, so gates can be judged on evidence.'
            )}
          </span>
        )}
      </span>
    </li>
  )
}

/**
 * The pre-fill, deliberately placed above the choice rather than on one of its buttons. It states
 * what the policy would have done and why; it never marks a button, pre-selects one, or takes
 * focus. Below level 1 nothing reaches the renderer at all — the main process withholds it — so
 * those answers are given blind and the two populations stay comparable.
 */
function PolicyAdvisory({ gate }: { gate: PendingGateView }): React.JSX.Element | null {
  if (!gate.recommendation) {
    return gate.policyEvaluated ? (
      <p className="text-[10px] leading-snug text-muted-foreground italic">
        {translate(
          'auto.components.right.sidebar.gate.panel.withheld',
          'The policy recorded a decision for this step, but this member has not run this stage often enough for it to be shown yet.'
        )}
      </p>
    ) : null
  }
  const reason = gate.recommendation.reason
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-muted/40 px-2 py-1.5">
      <span className="text-[10px] font-medium text-foreground">
        {policyWouldHaveSentence(gate.recommendation.decision)}
      </span>
      <span className="text-[10px] leading-snug text-muted-foreground">
        {gateReasonSentence({
          decision: gate.recommendation.decision,
          reason: isGateDecisionReason(reason) ? reason : 'unknown'
        })}
      </span>
    </div>
  )
}

function GateNotice({
  text,
  detail,
  onRefresh
}: {
  text: string
  detail?: string
  onRefresh?: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-1 px-3 py-4 text-xs text-muted-foreground">
      <p>{text}</p>
      {detail ? <p className="font-mono text-[10px] break-words">{detail}</p> : null}
      {onRefresh ? (
        <Button variant="ghost" size="sm" className="mt-1 h-6 px-2 text-xs" onClick={onRefresh}>
          {translate('auto.components.right.sidebar.gate.panel.retry', 'Try again')}
        </Button>
      ) : null}
    </div>
  )
}
