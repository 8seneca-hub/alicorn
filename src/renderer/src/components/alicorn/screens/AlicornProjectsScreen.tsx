/**
 * Every project at once — the answer to "what is running, and what needs me".
 *
 * A project with nothing waiting says "clear" rather than showing a zero, because the point of the
 * card is to be scannable: the eye should catch the projects that want something.
 */
import React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { AlicornProjectsState } from '../shell/use-alicorn-projects'
import { AlicornShellUnavailableNotice } from '../shell/AlicornShell'
import { AlicornEmptyState, AlicornScreenBody, AlicornScreenHeader } from './AlicornScreenChrome'
import { AlicornNewProjectDialog } from './AlicornNewProjectDialog'

export function AlicornProjectsScreen({
  state,
  waitingByProject,
  onOpen
}: {
  state: AlicornProjectsState
  waitingByProject: Record<string, number>
  onOpen: (projectId: string) => void
}): React.JSX.Element {
  const [creating, setCreating] = React.useState(false)

  if (state.error) {
    return <AlicornShellUnavailableNotice detail={state.error} />
  }

  return (
    <>
      <AlicornScreenHeader
        crumbs={['Alicorn']}
        title={translate('auto.components.alicorn.shell.projects', 'Projects')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            {translate('auto.components.alicorn.projects.new', 'New project')}
          </Button>
        }
      />
      <AlicornScreenBody>
        {state.loading ? (
          <div className="text-sm text-muted-foreground">
            {translate('auto.components.alicorn.projects.loading', 'Reading projects…')}
          </div>
        ) : state.projects.length === 0 ? (
          <AlicornEmptyState
            title={translate('auto.components.alicorn.projects.emptyTitle', 'No projects yet')}
            detail={translate(
              'auto.components.alicorn.projects.emptyDetail',
              'A project is an instance of the org library — its members, workflows and checks — with its own repositories and board.'
            )}
            action={
              <Button size="sm" className="mt-3 gap-1.5" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" />
                {translate('auto.components.alicorn.projects.new', 'New project')}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {state.projects.map((project) => {
              const waiting = waitingByProject[project.id] ?? 0
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onOpen(project.id)}
                  className="flex flex-col rounded-xl border border-border bg-card p-4 text-left transition hover:border-foreground/20"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-base font-semibold">{project.name}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                        waiting > 0
                          ? 'border-status-attention/40 bg-status-attention/10 text-status-attention'
                          : 'border-border text-muted-foreground'
                      )}
                    >
                      {waiting > 0
                        ? translate(
                            'auto.components.alicorn.projects.needsYou',
                            '{{count}} needs you',
                            { count: waiting }
                          )
                        : translate('auto.components.alicorn.projects.clear', 'clear')}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-5 text-[12.5px]">
                    <span className="text-muted-foreground">
                      {translate('auto.components.alicorn.projects.key', 'Key')}{' '}
                      <span className="font-mono text-foreground">{project.key}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {translate('auto.components.alicorn.projects.repos', 'Repos')}{' '}
                      <span className="font-mono tabular-nums text-foreground">
                        {project.repoIds.length}
                      </span>
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </AlicornScreenBody>
      <AlicornNewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={state.create}
        onCreated={onOpen}
      />
    </>
  )
}
