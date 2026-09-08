import React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { formatRunCostSummary } from '../../../../../shared/alicorn/run-cost'
import type { RunInspectorView } from '../../../../../shared/alicorn/run-inspector-view'
import { ContextInspectorDispatchRow } from './ContextInspectorDispatchRow'
import { useContextInspectorState } from './use-context-inspector-state'

/**
 * UI3. PV1's panel answers "was a human asked, and why not"; this one answers the question
 * underneath it — what was this member actually given, and what did the run cost to find out.
 * CLAUDE.md: a context capture is the only way to tell an underinformed member from a wrong one.
 */
export function ContextInspectorPanel({
  isVisible = true
}: {
  isVisible?: boolean
}): React.JSX.Element {
  const { result, target, selectRun, refresh } = useContextInspectorState({ isVisible })
  const [openDispatchId, setOpenDispatchId] = React.useState<string | null>(null)

  if (!target) {
    return (
      <InspectorNotice
        text={translate(
          'auto.components.right.sidebar.context.inspector.panel.no.branch',
          'This workspace has no branch, so there is nothing to look a run up by. The ledger keys a run by repository and branch.'
        )}
      />
    )
  }
  if (result === null) {
    return (
      <InspectorNotice
        text={translate(
          'auto.components.right.sidebar.context.inspector.panel.loading',
          'Reading the ledger…'
        )}
      />
    )
  }
  if (!result.ok) {
    return (
      <InspectorNotice
        text={translate(
          'auto.components.right.sidebar.context.inspector.panel.unavailable',
          'The ledger could not be read for this branch. Nothing is claimed about it either way.'
        )}
        detail={result.error}
        onRefresh={refresh}
      />
    )
  }
  if (result.view.runs.length === 0) {
    return (
      <InspectorNotice
        text={translate(
          'auto.components.right.sidebar.context.inspector.panel.empty',
          'No dispatch has settled on this branch yet. Captures appear here as members are briefed.'
        )}
        detail={target.branch}
        onRefresh={refresh}
      />
    )
  }
  return (
    <div className="scrollbar-sleek flex h-full flex-col overflow-y-auto">
      <InspectorHeader
        view={result.view}
        onSelectRun={(runId) => {
          setOpenDispatchId(null)
          selectRun(runId)
        }}
        onRefresh={refresh}
      />
      <ul className="flex flex-col" data-testid="context-inspector-dispatches">
        {result.view.dispatches.map((dispatch) => (
          <ContextInspectorDispatchRow
            key={dispatch.dispatchId}
            runId={result.view.runId}
            dispatch={dispatch}
            expanded={openDispatchId === dispatch.dispatchId}
            // One open at a time: expanding a second would put a second 64 KiB prompt in the DOM.
            onToggle={() =>
              setOpenDispatchId((current) =>
                current === dispatch.dispatchId ? null : dispatch.dispatchId
              )
            }
          />
        ))}
      </ul>
      <InspectorGaps view={result.view} />
    </div>
  )
}

function InspectorHeader({
  view,
  onSelectRun,
  onRefresh
}: {
  view: RunInspectorView
  onSelectRun: (runId: string) => void
  onRefresh: () => void
}): React.JSX.Element {
  const captured = view.dispatches.filter((d) => d.prompt.kind !== 'none').length
  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-[10px] text-muted-foreground">{view.branch}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-5 shrink-0"
          onClick={onRefresh}
          title={translate(
            'auto.components.right.sidebar.context.inspector.panel.refresh',
            'Re-read the ledger'
          )}
        >
          <RefreshCw className="size-3" />
        </Button>
      </div>
      {view.runs.length > 1 ? (
        <Select value={view.runId} onValueChange={onSelectRun}>
          <SelectTrigger
            size="sm"
            className="h-6 w-full font-mono text-[10px]"
            data-testid="context-inspector-run-select"
            aria-label={translate(
              'auto.components.right.sidebar.context.inspector.panel.run.label',
              'Run'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {view.runs.map((run) => (
              <SelectItem key={run.runId} value={run.runId} className="font-mono text-[10px]">
                {run.runId} · {run.dispatchCount}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="truncate font-mono text-[10px] text-muted-foreground">{view.runId}</span>
      )}
      <p className="text-[10px] text-muted-foreground" data-testid="context-inspector-totals">
        {view.dispatches.length}{' '}
        {translate(
          'auto.components.right.sidebar.context.inspector.panel.totals.dispatches',
          'dispatches'
        )}{' '}
        · {captured}{' '}
        {translate(
          'auto.components.right.sidebar.context.inspector.panel.totals.captured',
          'captured'
        )}{' '}
        · {formatRunCostSummary(view.cost)}
      </p>
    </div>
  )
}

/**
 * The honest half, in PV1's shape. Every line here is a thing the ledger genuinely cannot say yet;
 * none of them is filled in with a guess.
 */
function InspectorGaps({ view }: { view: RunInspectorView }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0">
      <h3 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {translate(
          'auto.components.right.sidebar.context.inspector.panel.section.gaps',
          'Not in this record'
        )}
      </h3>
      {view.capturesTruncated ? (
        <p className="text-xs text-muted-foreground" data-testid="context-inspector-truncated">
          {translate(
            'auto.components.right.sidebar.context.inspector.panel.gaps.truncated',
            'This run holds more captures than the ledger returns in one read, so some dispatches below show as not captured when they were.'
          )}
        </p>
      ) : null}
      {view.dispatchesOutsideBranch > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="context-inspector-outside">
          {translate(
            'auto.components.right.sidebar.context.inspector.panel.gaps.outside',
            'The run also has {{value0}} dispatches outside this branch, so the list above is a slice of it. The cost is the whole run.',
            { value0: view.dispatchesOutsideBranch }
          )}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.right.sidebar.context.inspector.panel.gaps.body',
          'A capture is what the member was given, not what it did with it. The ledger records no reply, no tool calls, and no reading order; verifications cover diff coverage only, and an interruption records when it was raised but not when it was answered.'
        )}
      </p>
    </section>
  )
}

function InspectorNotice({
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
          {translate('auto.components.right.sidebar.context.inspector.panel.retry', 'Try again')}
        </Button>
      ) : null}
    </div>
  )
}
