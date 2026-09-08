import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatSpendCents } from '../../../../../shared/alicorn/provenance-view'
import type { ProvenanceCheckView } from '../../../../../shared/alicorn/provenance-view'
import type { RunInspectorDispatch } from '../../../../../shared/alicorn/run-inspector-view'
import { CHECK_COLOR, CHECK_ICON } from '../provenance-panel/provenance-check-copy'
import { GATE_DECISION_COLOR, gateDecisionLabel } from '../provenance-panel/provenance-gate-copy'
import { CAPTURED_PROMPT_COLOR, capturedPromptLabel } from './captured-prompt-copy'
import { CapturedPromptBody } from './CapturedPromptBody'

/**
 * One dispatch. Collapsed it says where the prompt is; expanded it fetches and shows it — so at
 * most one prompt is ever in the DOM, whatever the length of the run.
 */
export function ContextInspectorDispatchRow({
  runId,
  dispatch,
  expanded,
  onToggle
}: {
  runId: string
  dispatch: RunInspectorDispatch
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <li className="flex flex-col border-b border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex flex-col gap-1 px-3 py-2 text-left hover:bg-accent/40"
        data-testid="context-inspector-dispatch"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Chevron className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium text-foreground">{dispatch.stageKey}</span>
          <Badge
            variant="outline"
            className={cn('ml-auto shrink-0', CAPTURED_PROMPT_COLOR[dispatch.prompt.kind])}
          >
            {capturedPromptLabel(dispatch.prompt)}
          </Badge>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
          <span>{dispatch.member ?? '—'}</span>
          <span className="font-mono">{dispatch.backend}</span>
          <span className={cn(dispatch.outcome === 'failed' && 'text-rose-500')}>
            {dispatch.outcome}
          </span>
          <span>
            {dispatch.filesModified}{' '}
            {translate('auto.components.right.sidebar.context.inspector.panel.files', 'files')}
          </span>
          <span>{formatSpendCents(dispatch.spendCents)}</span>
          <Badge
            variant="outline"
            className={cn('shrink-0', GATE_DECISION_COLOR[dispatch.gate.decision])}
          >
            {gateDecisionLabel(dispatch.gate.decision)}
          </Badge>
        </span>
        <DispatchChecks checks={dispatch.checks} />
      </button>
      {expanded ? (
        <div className="px-3 pb-2">
          <CapturedPromptBody
            runId={runId}
            dispatchId={dispatch.dispatchId}
            prompt={dispatch.prompt}
          />
        </div>
      ) : null}
    </li>
  )
}

function DispatchChecks({
  checks
}: {
  checks: readonly ProvenanceCheckView[]
}): React.JSX.Element | null {
  if (checks.length === 0) {
    return null
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
      {checks.map((check) => {
        const Icon = CHECK_ICON[check.status]
        return (
          <span key={`${check.kind}:${check.name}`} className="flex items-center gap-1">
            <Icon className={cn('size-3 shrink-0', CHECK_COLOR[check.status])} />
            {check.name}
            {check.ratio === null ? '' : ` ${Math.round(check.ratio * 100)}%`}
          </span>
        )
      })}
    </span>
  )
}
