/**
 * The header every Alicorn screen wears, so the crumb and the title sit in one place rather than
 * being re-laid out per screen and drifting apart.
 */
import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { translate } from '@/i18n/i18n'

/** A crumb is a place unless it is given somewhere to go. */
export type AlicornCrumb = string | { label: string; onClick: () => void }

function crumbLabel(crumb: AlicornCrumb): string {
  return typeof crumb === 'string' ? crumb : crumb.label
}

/** Keyed by the trail up to it, not its position: two crumbs may share a label, a path never does. */
function crumbTrail(crumbs: readonly AlicornCrumb[]): { crumb: AlicornCrumb; key: string }[] {
  return crumbs.map((crumb, index) => ({
    crumb,
    key: crumbs
      .slice(0, index + 1)
      .map(crumbLabel)
      .join(' / ')
  }))
}

/** Every project screen wears the same trail, so it is built once. */
export function projectCrumbs(projectName: string, onAllProjects: () => void): AlicornCrumb[] {
  return [
    {
      label: translate('auto.components.alicorn.shell.projects', 'Projects'),
      onClick: onAllProjects
    },
    projectName
  ]
}

/**
 * The crumb row, with the back arrow that belongs to it.
 *
 * Split from the standard header because a screen with its own header — the task session — still
 * wants this row spelled identically rather than re-laid out.
 */
export function AlicornCrumbs({
  crumbs,
  onBack
}: {
  crumbs: AlicornCrumb[]
  /** Renders a back arrow before the trail. Only screens you descend *into* pass one. */
  onBack?: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={translate('auto.components.alicorn.screen.back', 'Back')}
          className="-ml-1.5 mr-0.5 flex size-5 shrink-0 items-center justify-center rounded-md transition hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
        </button>
      ) : null}
      {crumbTrail(crumbs).map(({ crumb, key }, index) => (
        <React.Fragment key={key}>
          {index > 0 ? <span className="opacity-50">/</span> : null}
          {typeof crumb === 'string' ? (
            <span>{crumb}</span>
          ) : (
            <button
              type="button"
              onClick={crumb.onClick}
              className="hover:text-foreground hover:underline"
            >
              {crumb.label}
            </button>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export function AlicornScreenHeader({
  crumbs,
  title,
  actions,
  onBack
}: {
  crumbs: AlicornCrumb[]
  title: string
  actions?: React.ReactNode
  /** Renders a back arrow before the title. Only screens you descend *into* pass one. */
  onBack?: () => void
}): React.JSX.Element {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-9 pb-3.5 pt-4">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={translate('auto.components.alicorn.screen.back', 'Back')}
          className="-ml-2 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <AlicornCrumbs crumbs={crumbs} />
        <h1 className="mt-0.5 text-[17px] font-semibold">{title}</h1>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function AlicornScreenBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-9 pb-12 pt-7">{children}</div>
  )
}

export function AlicornEmptyState({
  title,
  detail,
  action
}: {
  title: string
  detail: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-16 text-center">
      <div className="text-sm font-semibold">{title}</div>
      <div className="max-w-sm text-[12.5px] text-muted-foreground">{detail}</div>
      {action}
    </div>
  )
}
