/**
 * Every project at once — the answer to "what is running, and what needs me".
 *
 * A project with nothing waiting says "clear" rather than showing a zero, because the point of the
 * card is to be scannable: the eye should catch the projects that want something. The figures are
 * counted once in the shell and passed down, so a card and the sidebar row beside it can never
 * disagree about how much is open.
 */
import React from 'react'
import { Command, PackageOpen, Plus, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { formatRunCostSummary, type RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import type { Project } from '../../../../../shared/alicorn/projects'
import { mergeRunCostSummaries } from './project-run-cost'
import type { AlicornProjectsState } from '../shell/use-alicorn-projects'
import { AlicornShellUnavailableNotice } from '../shell/AlicornShell'
import { AlicornEmptyState, AlicornScreenBody, AlicornScreenHeader } from './AlicornScreenChrome'
import { AlicornNewProjectDialog } from './AlicornNewProjectDialog'
import { AlicornImportProjectDialog } from './AlicornImportProjectDialog'

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-[15px] tabular-nums">{value}</div>
    </div>
  )
}

export function AlicornProjectsScreen({
  state,
  projects,
  waitingByProject,
  openByProject,
  spendByProject,
  creating,
  onCreatingChange,
  importing,
  onImportingChange,
  onOpen
}: {
  state: AlicornProjectsState
  /** Already filtered by the sidebar's search, so both lists agree on what is shown. */
  projects: Project[]
  waitingByProject: Record<string, number>
  openByProject: Record<string, number>
  spendByProject: Record<string, RunCostSummary>
  creating: boolean
  onCreatingChange: (open: boolean) => void
  importing: boolean
  onImportingChange: (open: boolean) => void
  onOpen: (projectId: string) => void
}): React.JSX.Element {
  const openModal = useAppStore((store) => store.openModal)

  if (state.error) {
    return <AlicornShellUnavailableNotice detail={state.error} />
  }

  const totalOpen = projects.reduce((sum, project) => sum + (openByProject[project.id] ?? 0), 0)
  const totalWaiting = projects.reduce(
    (sum, project) => sum + (waitingByProject[project.id] ?? 0),
    0
  )
  const totalSpend = mergeRunCostSummaries(
    projects.map((project) => spendByProject[project.id] ?? { costUsd: null, partial: false })
  )

  return (
    <>
      <AlicornScreenHeader
        crumbs={['Alicorn']}
        title={translate('auto.components.alicorn.shell.projects', 'Projects')}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => openModal('worktree-palette')}
            >
              <Command className="size-3.5" />
              {translate('auto.components.alicorn.projects.commandBar', 'Command bar')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => onImportingChange(true)}
            >
              <PackageOpen className="size-3.5" />
              {translate('auto.components.alicorn.projects.import', 'Import from a PM tool')}
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => onCreatingChange(true)}>
              <Plus className="size-3.5" />
              {translate('auto.components.alicorn.projects.new', 'New project')}
            </Button>
          </>
        }
      />
      <AlicornScreenBody>
        {state.loading ? (
          <div className="text-sm text-muted-foreground">
            {translate('auto.components.alicorn.projects.loading', 'Reading projects…')}
          </div>
        ) : projects.length === 0 ? (
          <AlicornEmptyState
            title={translate('auto.components.alicorn.projects.emptyTitle', 'No projects yet')}
            detail={translate(
              'auto.components.alicorn.projects.emptyDetail',
              'A project is an instance of the org library — its members, workflows and checks — with its own repositories and board.'
            )}
            action={
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => onImportingChange(true)}
                >
                  <PackageOpen className="size-3.5" />
                  {translate('auto.components.alicorn.projects.import', 'Import from a PM tool')}
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => onCreatingChange(true)}>
                  <Plus className="size-3.5" />
                  {translate('auto.components.alicorn.projects.new', 'New project')}
                </Button>
              </div>
            }
          />
        ) : (
          <>
            <p className="mb-6 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
              {translate(
                'auto.components.alicorn.projects.intro',
                'Several projects run at once against one org library — the same members, workflows and required checks, configured differently per project.'
              )}
            </p>

            <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
              {projects.map((project) => {
                const waiting = waitingByProject[project.id] ?? 0
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onOpen(project.id)}
                    className="flex flex-col rounded-xl border border-border bg-card p-4 text-left transition hover:border-foreground/20"
                  >
                    <div className="flex items-start justify-between gap-2">
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

                    <div className="mt-4 flex gap-6">
                      <Stat
                        label={translate('auto.components.alicorn.projects.open', 'Open')}
                        value={String(openByProject[project.id] ?? 0)}
                      />
                      <Stat
                        label={translate('auto.components.alicorn.projects.repos', 'Repos')}
                        value={String(project.repoIds.length)}
                      />
                      <Stat
                        label={translate('auto.components.alicorn.projects.key', 'Key')}
                        value={project.key}
                      />
                      <Stat
                        label={translate('auto.components.alicorn.project.spend', 'Spend')}
                        value={formatRunCostSummary(
                          spendByProject[project.id] ?? { costUsd: null, partial: false }
                        )}
                      />
                    </div>

                    <div className="mt-4 border-t border-border pt-3">
                      <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                        <Workflow className="size-3.5" />
                        {translate(
                          'auto.components.alicorn.projects.inherits',
                          'Inherits the org library'
                        )}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>

            <section className="mt-8">
              <h2 className="mb-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {translate('auto.components.alicorn.projects.across', 'Across all projects')}
              </h2>
              <div className="flex flex-wrap gap-10 rounded-xl border border-border bg-card px-5 py-4">
                <Stat
                  label={translate('auto.components.alicorn.projects.openWork', 'Open work')}
                  value={String(totalOpen)}
                />
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {translate('auto.components.alicorn.projects.waitingOnYou', 'Waiting on you')}
                  </div>
                  <div
                    className={cn(
                      'mt-1 font-mono text-[15px] tabular-nums',
                      totalWaiting > 0 && 'text-status-attention'
                    )}
                  >
                    {totalWaiting}
                  </div>
                </div>
                <Stat
                  label={translate('auto.components.alicorn.projects.projectCount', 'Projects')}
                  value={String(projects.length)}
                />
                <Stat
                  label={translate('auto.components.alicorn.projects.totalSpend', 'Spend')}
                  value={formatRunCostSummary(totalSpend)}
                />
              </div>
            </section>
          </>
        )}
      </AlicornScreenBody>
      <AlicornNewProjectDialog
        open={creating}
        onOpenChange={onCreatingChange}
        onCreate={state.create}
        onCreated={onOpen}
      />
      <AlicornImportProjectDialog
        open={importing}
        onOpenChange={onImportingChange}
        onCreate={state.create}
        onImported={onOpen}
      />
    </>
  )
}
