import { useCallback, useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { TaskPageComposerActionsModel } from '../../use-task-page-composer-actions'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import type { PlaneIssue } from '../../../../../shared/plane-types'
import { PlaneIssueDetail } from './PlaneIssueDetail'
import { PlaneIssueList } from './PlaneIssueList'
import { usePlaneStartWork } from './use-plane-start-work'
import { usePlaneProjectData } from './use-plane-project-data'
import { translate } from '@/i18n/i18n'

export function TaskPagePlaneContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  const { planeStatusReady, planeConnected, hideTaskSource } = model
  const planeError = useAppStore((s) => s.planeError)
  const planeLoading = useAppStore((s) => s.planeLoading)
  const [selectedIssue, setSelectedIssue] = useState<PlaneIssue | null>(null)
  const { issues, states, refresh } = usePlaneProjectData(planeConnected)

  const onSelect = useCallback((issue: PlaneIssue) => setSelectedIssue(issue), [])
  const startWork = usePlaneStartWork()

  // A project switch must not leave the previous project's issue selected.
  const selectedProjectId = useAppStore((s) => s.selectedPlaneProjectId)
  useEffect(() => {
    setSelectedIssue(null)
  }, [selectedProjectId])

  if (!planeStatusReady) {
    return (
      <div className="mt-4 flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!planeConnected) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
        <PlaneIcon className="mb-4 size-8 text-muted-foreground/60" />
        <p className="text-base font-medium text-foreground">
          {translate('auto.components.task.page.plane.connectTitle', 'Connect a Plane workspace')}
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {translate(
            'auto.components.task.page.plane.connectBody',
            'Connect Plane in Settings → Integrations, then pick a default project.'
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={() => hideTaskSource('plane', 'Plane')}>
            {translate('auto.components.task.page.plane.hide', 'Hide Plane')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
      <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
        <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {translate('auto.components.task.page.plane.heading', 'Plane issues')}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={planeLoading}>
          {translate('auto.components.task.page.plane.refresh', 'Refresh')}
        </Button>
      </div>
      {planeError ? <p className="px-3 py-2 text-xs text-destructive">{planeError}</p> : null}
      {selectedIssue ? (
        <PlaneIssueDetail
          issue={selectedIssue}
          states={states}
          onStartWork={startWork}
          onClose={() => setSelectedIssue(null)}
        />
      ) : planeLoading && issues.length === 0 ? (
        <div className="flex items-center justify-center py-14">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <PlaneIssueList
          issues={issues}
          states={states}
          selectedIssueId={null}
          onSelect={onSelect}
        />
      )}
    </div>
  )
}
