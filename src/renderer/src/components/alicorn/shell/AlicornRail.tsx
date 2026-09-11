/**
 * The icon rail. Three destinations and a badge.
 *
 * It is the only thing in this shell that does not change with the scope, which is what lets the
 * sidebar beside it change completely: the rail says where you are, the sidebar says what is
 * there. Splitting them is the fix for the defect the prototype was drawn to correct — a screen
 * showing a project's name while editing something no project owns.
 */
import React from 'react'
import { Building2, FolderGit2, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { AlicornRailTarget } from './alicorn-shell-route'

type RailButton = {
  target: AlicornRailTarget
  label: string
  Icon: typeof Inbox
}

export function AlicornRail({
  active,
  waiting,
  onSelect
}: {
  active: AlicornRailTarget
  /** Open gates across every project. Zero hides the badge rather than showing a quiet nought. */
  waiting: number
  onSelect: (target: AlicornRailTarget) => void
}): React.JSX.Element {
  const buttons: RailButton[] = [
    {
      target: 'projects',
      label: translate('auto.components.alicorn.shell.projects', 'Projects'),
      Icon: FolderGit2
    },
    {
      target: 'org',
      label: translate('auto.components.alicorn.shell.organisation', 'Organisation'),
      Icon: Building2
    },
    {
      target: 'inbox',
      label: translate('auto.components.alicorn.shell.inbox', 'Inbox'),
      Icon: Inbox
    }
  ]

  return (
    <nav
      aria-label={translate('auto.components.alicorn.shell.railLabel', 'Alicorn sections')}
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-2"
    >
      {buttons.map(({ target, label, Icon }) => (
        <button
          key={target}
          type="button"
          title={label}
          aria-label={label}
          aria-current={active === target ? 'page' : undefined}
          onClick={() => onSelect(target)}
          className={cn(
            'relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition',
            active === target
              ? 'bg-accent text-foreground shadow-[inset_2px_0_0_var(--color-foreground)]'
              : 'hover:bg-accent hover:text-foreground'
          )}
        >
          <Icon className="size-[18px]" />
          {target === 'inbox' && waiting > 0 ? (
            <span
              data-testid="alicorn-rail-inbox-badge"
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
