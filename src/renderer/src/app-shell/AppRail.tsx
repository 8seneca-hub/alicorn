/**
 * The icon rail: the app's leftmost column, and the thing that makes the scope explicit.
 *
 * It is permanent chrome rather than a page, because the whole point of the IA is that the rail
 * says *where you are* while the column beside it says *what is there*. Splitting those two is
 * what stops a screen showing a project's name while editing something no project owns.
 *
 * Orca's machinery is untouched underneath — terminals, SSH hosts and worktrees all still run the
 * way they did. What changed is the frame around them.
 */
import React from 'react'
import { Command, Inbox, LayoutGrid, Settings as SettingsIcon, SquareLibrary } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useGatePanelState } from '@/components/right-sidebar/gate-panel/use-gate-panel-state'
import { isMacUserAgent } from '@/components/terminal-pane/pane-helpers'

type RailTarget = 'projects' | 'org' | 'settings' | 'inbox'

export function AppRail(): React.JSX.Element {
  const activeView = useAppStore((state) => state.activeView)
  const alicornScope = useAppStore((state) => state.alicornScope)
  const openAlicornPage = useAppStore((state) => state.openAlicornPage)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openModal = useAppStore((state) => state.openModal)
  // The badge is the one number a developer should never have to go looking for, so it polls for
  // as long as the rail is mounted — which is always.
  const { gates } = useGatePanelState({ isVisible: true })
  const waiting = gates?.length ?? 0

  const active: RailTarget | null =
    activeView === 'settings'
      ? 'settings'
      : activeView === 'alicorn'
        ? alicornScope === 'inbox'
          ? 'inbox'
          : alicornScope === 'org'
            ? 'org'
            : 'projects'
        : null

  const buttons: { target: RailTarget; label: string; Icon: typeof Inbox; go: () => void }[] = [
    {
      target: 'projects',
      label: translate('auto.app.rail.projects', 'Projects'),
      Icon: SquareLibrary,
      go: () => openAlicornPage('projects')
    },
    {
      target: 'org',
      label: translate('auto.app.rail.org', 'Organisation'),
      Icon: LayoutGrid,
      go: () => openAlicornPage('org')
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
      className={cn(
        'flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar pb-2.5',
        // macOS draws its traffic lights over the top-left of the window, and the rail is now what
        // is under them. Without this the first button is unclickable behind the close button.
        isMacUserAgent() ? 'pt-[38px]' : 'pt-2.5'
      )}
    >
      {buttons.map((button) => (
        <RailButton key={button.target} {...button} active={active === button.target} />
      ))}

      <div className="my-1 h-px w-6 bg-border" />

      <RailButton
        target="inbox"
        label={translate('auto.app.rail.inbox', 'Inbox')}
        Icon={Inbox}
        active={active === 'inbox'}
        badge={waiting}
        go={() => openAlicornPage('inbox')}
      />

      <div className="flex-1" />

      <button
        type="button"
        title={translate('auto.app.rail.commandBar', 'Command bar')}
        aria-label={translate('auto.app.rail.commandBar', 'Command bar')}
        onClick={() => openModal('worktree-palette')}
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <Command className="size-[18px]" strokeWidth={1.75} />
      </button>
      <div className="mt-1 flex size-7 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold">
        NA
      </div>
    </nav>
  )
}

function RailButton({
  label,
  Icon,
  active,
  badge,
  go
}: {
  target: RailTarget
  label: string
  Icon: typeof Inbox
  active: boolean
  badge?: number
  go: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={go}
      className={cn(
        'relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition',
        active
          ? 'bg-accent text-foreground shadow-[inset_2px_0_0_currentColor]'
          : 'hover:bg-accent hover:text-foreground'
      )}
    >
      <Icon className="size-[18px]" strokeWidth={active ? 2 : 1.75} />
      {badge !== undefined && badge > 0 ? (
        <span
          data-testid="app-rail-inbox-badge"
          className="absolute right-0.5 top-0.5 flex min-w-[15px] items-center justify-center rounded-full bg-status-attention px-1 text-[9px] font-bold text-background"
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}
