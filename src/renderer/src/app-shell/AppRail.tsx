/**
 * The icon rail: the app's leftmost column, and the thing that makes the scope explicit.
 *
 * It is permanent chrome rather than a page, because the whole point of the prototype's IA is that
 * the rail says *where you are* while the column beside it says *what is there*. Splitting those
 * two is what stops a screen showing a project's name while editing something no project owns.
 *
 * Workspaces keeps Orca's worktree sidebar and terminal underneath it, untouched — the rail
 * changes what the frame looks like, not how a session runs.
 */
import React from 'react'
import { Building2, FolderGit2, Inbox, Settings as SettingsIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useGatePanelState } from '@/components/right-sidebar/gate-panel/use-gate-panel-state'

type RailTarget = 'workspaces' | 'projects' | 'inbox' | 'settings'

export function AppRail(): React.JSX.Element {
  const activeView = useAppStore((state) => state.activeView)
  const alicornScope = useAppStore((state) => state.alicornScope)
  const setActiveView = useAppStore((state) => state.setActiveView)
  const openAlicornPage = useAppStore((state) => state.openAlicornPage)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  // Polling only while the rail is mounted, which it always is — the badge is the one number a
  // developer should never have to go looking for.
  const { gates } = useGatePanelState({ isVisible: true })
  const waiting = gates?.length ?? 0

  const active: RailTarget =
    activeView === 'settings'
      ? 'settings'
      : activeView === 'alicorn'
        ? alicornScope === 'inbox'
          ? 'inbox'
          : 'projects'
        : 'workspaces'

  const buttons: { target: RailTarget; label: string; Icon: typeof Inbox; go: () => void }[] = [
    {
      target: 'workspaces',
      label: translate('auto.app.rail.workspaces', 'Workspaces'),
      Icon: FolderGit2,
      go: () => setActiveView('terminal')
    },
    {
      target: 'projects',
      label: translate('auto.app.rail.projects', 'Projects'),
      Icon: Building2,
      go: () => openAlicornPage('projects')
    },
    {
      target: 'inbox',
      label: translate('auto.app.rail.inbox', 'Inbox'),
      Icon: Inbox,
      go: () => openAlicornPage('inbox')
    },
    {
      target: 'settings',
      label: translate('auto.app.rail.settings', 'Settings'),
      Icon: SettingsIcon,
      go: () => openSettingsPage()
    }
  ]

  return (
    <nav
      aria-label={translate('auto.app.rail.label', 'Sections')}
      // Why no-drag: the rail sits under the window's drag region on custom chrome, and a
      // draggable button is a button that does not click.
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-2"
    >
      {buttons.map(({ target, label, Icon, go }) => (
        <button
          key={target}
          type="button"
          title={label}
          aria-label={label}
          aria-current={active === target ? 'page' : undefined}
          onClick={go}
          className={cn(
            'relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition',
            active === target
              ? 'bg-accent text-foreground shadow-[inset_2px_0_0_currentColor]'
              : 'hover:bg-accent hover:text-foreground'
          )}
        >
          <Icon className="size-[18px]" strokeWidth={active === target ? 2 : 1.75} />
          {target === 'inbox' && waiting > 0 ? (
            <span
              data-testid="app-rail-inbox-badge"
              className="absolute right-1 top-1 flex min-w-[15px] items-center justify-center rounded-full bg-status-attention px-1 text-[9px] font-bold text-background"
            >
              {waiting}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  )
}
