/**
 * The header every Alicorn screen wears, so the crumb and the title sit in one place rather than
 * being re-laid out per screen and drifting apart.
 */
import React from 'react'

export function AlicornScreenHeader({
  crumbs,
  title,
  actions
}: {
  crumbs: string[]
  title: string
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-9 pb-3.5 pt-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {crumbs.map((crumb, index) => (
            <React.Fragment key={`${crumb}-${index}`}>
              {index > 0 ? <span className="opacity-50">/</span> : null}
              <span>{crumb}</span>
            </React.Fragment>
          ))}
        </div>
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
