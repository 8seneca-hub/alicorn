import React from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  formatSpendCents,
  type ProvenanceStepView,
  type ProvenanceView
} from '../../../../../shared/alicorn/provenance-view'
import { GATE_DECISION_COLOR, gateDecisionLabel, gateReasonSentence } from './provenance-gate-copy'
import { ProvenanceChecks, ProvenanceGaps, ProvenancePolicy } from './ProvenanceEvidenceSections'
import { useProvenancePanelState } from './use-provenance-panel-state'

/**
 * "Why no human was asked", in the app. The pull-request body answers it for a stranger once; this
 * answers it for the developer while the work is still open, off the same `ProvenanceView`.
 */
export function ProvenancePanel({ isVisible = true }: { isVisible?: boolean }): React.JSX.Element {
  const { result, target, refresh } = useProvenancePanelState({ isVisible })

  if (!target) {
    return (
      <ProvenanceNotice
        text={translate(
          'auto.components.right.sidebar.provenance.panel.no.branch',
          'This workspace has no branch, so there is nothing to look the record up by. The ledger keys a run by repository and branch.'
        )}
      />
    )
  }
  if (result === null) {
    return (
      <ProvenanceNotice
        text={translate(
          'auto.components.right.sidebar.provenance.panel.loading',
          'Reading the ledger…'
        )}
      />
    )
  }
  if (!result.ok) {
    return (
      <ProvenanceNotice
        text={translate(
          'auto.components.right.sidebar.provenance.panel.unavailable',
          'The ledger could not be read for this branch. Nothing is claimed about it either way.'
        )}
        detail={result.error}
        onRefresh={refresh}
      />
    )
  }
  if (result.view.steps.length === 0) {
    return (
      <ProvenanceNotice
        text={translate(
          'auto.components.right.sidebar.provenance.panel.empty',
          'No step has settled on this branch yet. The record fills in as members finish work.'
        )}
        detail={target.branch}
        onRefresh={refresh}
      />
    )
  }
  return <ProvenanceBody view={result.view} onRefresh={refresh} />
}

function ProvenanceBody({
  view,
  onRefresh
}: {
  view: ProvenanceView
  onRefresh: () => void
}): React.JSX.Element {
  return (
    <div className="scrollbar-sleek flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {view.branch}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-5 shrink-0"
            onClick={onRefresh}
            title={translate(
              'auto.components.right.sidebar.provenance.panel.refresh',
              'Re-read the ledger'
            )}
          >
            <RefreshCw className="size-3" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn('shrink-0', GATE_DECISION_COLOR.auto)}>
            {view.gateCounts.auto}{' '}
            {translate('auto.components.right.sidebar.provenance.panel.count.auto', 'auto')}
          </Badge>
          <Badge variant="outline" className={cn('shrink-0', GATE_DECISION_COLOR.gate)}>
            {view.gateCounts.gate}{' '}
            {translate('auto.components.right.sidebar.provenance.panel.count.gated', 'gated')}
          </Badge>
          {view.gateCounts.unknown > 0 ? (
            <Badge variant="outline" className={cn('shrink-0', GATE_DECISION_COLOR.unknown)}>
              {view.gateCounts.unknown}{' '}
              {translate(
                'auto.components.right.sidebar.provenance.panel.count.unknown',
                'not recorded'
              )}
            </Badge>
          ) : null}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {view.totals.tasks}{' '}
          {translate('auto.components.right.sidebar.provenance.panel.totals.steps', 'steps')} ·{' '}
          {view.totals.dispatches}{' '}
          {translate(
            'auto.components.right.sidebar.provenance.panel.totals.dispatches',
            'dispatches'
          )}{' '}
          · {formatSpendCents(view.totals.spendCents)}
        </p>
      </div>
      <ul className="flex flex-col" data-testid="provenance-steps">
        {view.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </ul>
      <ProvenanceChecks view={view} />
      <ProvenancePolicy view={view} />
      <ProvenanceGaps />
    </div>
  )
}

function StepRow({ step }: { step: ProvenanceStepView }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1 border-b border-border px-3 py-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-xs font-medium text-foreground">{step.stageKey}</span>
        <Badge
          variant="outline"
          className={cn('ml-auto shrink-0', GATE_DECISION_COLOR[step.gate.decision])}
        >
          {gateDecisionLabel(step.gate.decision)}
        </Badge>
      </span>
      <p className="text-xs leading-snug text-muted-foreground">{gateReasonSentence(step.gate)}</p>
      <span className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
        <span>{step.member ?? '—'}</span>
        <span className="font-mono">{step.backend}</span>
        <span>{step.executionStrategy}</span>
        <span className={cn(step.outcome === 'failed' && 'text-rose-500')}>{step.outcome}</span>
        <span>
          {step.filesModified}{' '}
          {translate('auto.components.right.sidebar.provenance.panel.step.files', 'files')}
        </span>
        <span>{formatSpendCents(step.spendCents)}</span>
      </span>
      {step.reportSummary ? (
        <p className="text-[10px] leading-snug text-muted-foreground italic">
          {step.reportSummary}
        </p>
      ) : null}
    </li>
  )
}

function ProvenanceNotice({
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
          {translate('auto.components.right.sidebar.provenance.panel.retry', 'Try again')}
        </Button>
      ) : null}
    </div>
  )
}
