import { PlaneStateBadge } from '@/components/sidebar/WorktreeCardMetadataStatusBadges'
import { Button } from '@/components/ui/button'
import type { PlaneIssue, PlaneState } from '../../../../../shared/plane-types'
import { planeDescriptionText } from './plane-description-text'
import { translate } from '@/i18n/i18n'

export function PlaneIssueDetail({
  issue,
  states,
  onStartWork,
  onClose
}: {
  issue: PlaneIssue
  states: readonly PlaneState[]
  onStartWork: (issue: PlaneIssue) => void
  onClose: () => void
}): React.JSX.Element {
  const state = states.find((candidate) => candidate.id === issue.stateId)
  const description = planeDescriptionText(issue.descriptionHtml)

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
      <div className="flex flex-none items-start justify-between gap-3 border-b border-border/50 px-3 py-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">{issue.readableId}</span>
            {state ? <PlaneStateBadge stateName={state.name} group={state.group} /> : null}
          </div>
          <h2 className="text-sm font-medium text-foreground">{issue.name}</h2>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={() => onStartWork(issue)}>
            {translate('auto.components.task.page.plane.startWork', 'Start work')}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            {translate('auto.components.task.page.plane.close', 'Close')}
          </Button>
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {description ? (
          // Plain text, deliberately: see planeDescriptionText.
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{description}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {translate('auto.components.task.page.plane.noDescription', 'No description.')}
          </p>
        )}
      </div>
    </div>
  )
}
