import { PlaneStateBadge } from '@/components/sidebar/WorktreeCardMetadataStatusBadges'
import type { PlaneIssue, PlaneState } from '../../../../../shared/plane-types'
import { groupPlaneIssuesByState } from './plane-issue-groups'
import { translate } from '@/i18n/i18n'

export function PlaneIssueList({
  issues,
  states,
  selectedIssueId,
  onSelect
}: {
  issues: readonly PlaneIssue[]
  states: readonly PlaneState[]
  selectedIssueId: string | null
  onSelect: (issue: PlaneIssue) => void
}): React.JSX.Element {
  const groups = groupPlaneIssuesByState(issues, states)

  if (groups.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        {translate('auto.components.task.page.plane.empty', 'No issues in this project.')}
      </p>
    )
  }

  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
      {groups.map((group) => (
        <section key={group.state.id}>
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-muted/35 px-3 py-1.5">
            <PlaneStateBadge stateName={group.state.name} group={group.state.group} />
            <span className="text-[11px] text-muted-foreground">{group.issues.length}</span>
          </div>
          <ul>
            {group.issues.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  aria-current={issue.id === selectedIssueId ? 'true' : undefined}
                  className={`flex w-full items-baseline gap-2 border-b border-border/30 px-3 py-2 text-left hover:bg-muted/40 ${
                    issue.id === selectedIssueId ? 'bg-muted/60' : ''
                  }`}
                  onClick={() => onSelect(issue)}
                >
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {issue.readableId}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {issue.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
