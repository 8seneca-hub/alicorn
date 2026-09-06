import type { TaskPageComposerActionsModel } from '../../use-task-page-composer-actions'
import { LoaderCircle } from 'lucide-react'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'

// The issue list is not built yet (ALC-52 phase D). Until it is, Plane still
// needs a surface of its own: without one the provider chain falls through and
// renders Linear's connect wall under a Plane source.
export function TaskPagePlaneContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  const { planeStatusReady, planeConnected, hideTaskSource } = model
  if (!planeStatusReady) {
    return (
      <div className="mt-4 flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
      <PlaneIcon className="mb-4 size-8 text-muted-foreground/60" />
      <p className="text-base font-medium text-foreground">
        {planeConnected
          ? translate(
              'auto.components.TaskPage.planeListPending',
              'Plane issues are not listed yet'
            )
          : translate('auto.components.TaskPage.planeConnect', 'Connect a Plane workspace')}
      </p>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {planeConnected
          ? translate(
              'auto.components.TaskPage.planeListPendingHint',
              'The workspace is connected. Browsing issues from here is not available yet.'
            )
          : translate(
              'auto.components.TaskPage.planeConnectHint',
              'Connect Plane in Settings to use it as a task source.'
            )}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={() => hideTaskSource('plane', 'Plane')}>
          {translate('auto.components.TaskPage.planeHide', 'Hide Plane')}
        </Button>
      </div>
    </div>
  )
}
