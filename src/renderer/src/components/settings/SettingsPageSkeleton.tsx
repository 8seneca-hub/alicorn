import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

// Why: this is the Suspense fallback for the lazy Settings chunk, so it must not pull anything from
// the settings module graph — importing one pane here would drag all of them onto the boot path.

function SkeletonBar({ className }: { className?: string }): React.JSX.Element {
  return <div className={cn('animate-pulse rounded bg-muted/60', className)} />
}

const NAV_GROUP_SKELETONS = [
  { id: 'device', rows: ['w-24', 'w-16', 'w-20', 'w-16', 'w-28', 'w-24'] },
  { id: 'account', rows: ['w-16', 'w-32', 'w-28', 'w-24'] },
  { id: 'project', rows: ['w-20', 'w-28', 'w-16'] }
] as const

const CONTENT_SKELETONS = [
  { id: 'card-1', rows: ['w-full', 'w-4/5', 'w-3/5'] },
  { id: 'card-2', rows: ['w-full', 'w-2/3'] }
] as const

/** The Settings chrome, drawn while its chunk loads, so the frame is there before the panes are. */
export function SettingsPageSkeleton(): React.JSX.Element {
  return (
    <div
      className="settings-view-shell flex min-h-0 flex-1 overflow-hidden bg-background"
      // Why: aria-label on a roleless div is not exposed to screen readers.
      role="status"
      aria-busy="true"
      aria-label={translate(
        'auto.components.settings.SettingsPageSkeleton.loading',
        'Loading settings'
      )}
    >
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-worktree-sidebar-border bg-worktree-sidebar">
        <div className="border-b border-worktree-sidebar-border px-3 py-3">
          <SkeletonBar className="h-8 w-32 rounded-md" />
        </div>
        <div className="border-b border-worktree-sidebar-border px-3 py-3">
          <SkeletonBar className="h-9 w-full rounded-md" />
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-hidden px-3 py-4">
          {NAV_GROUP_SKELETONS.map((group) => (
            <div key={group.id} className="space-y-2">
              <SkeletonBar className="ml-3 h-2.5 w-16" />
              <div className="space-y-1">
                {group.rows.map((row, index) => (
                  <div key={`${group.id}-${index}`} className="flex items-center gap-2 px-3 py-1.5">
                    <SkeletonBar className="size-4 shrink-0 rounded" />
                    <SkeletonBar className={cn('h-3.5', row)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-8 pt-10">
          <SkeletonBar className="h-7 w-48" />
          {CONTENT_SKELETONS.map((card) => (
            <div key={card.id} className="space-y-3 rounded-xl border border-border/60 p-5">
              <SkeletonBar className="h-4 w-40" />
              {card.rows.map((row, index) => (
                <SkeletonBar key={`${card.id}-${index}`} className={cn('h-3.5', row)} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
