/**
 * Board and Tasks: two readings of the same rows.
 *
 * Both open a worktree by handing it to the workspace view, which is the only thing that knows how
 * to run one. Nothing here duplicates that — a second way to activate a workspace would be a
 * second place for SSH host resolution to be got wrong.
 */
import React from 'react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../../shared/workspace-status-defaults'
import type { Worktree } from '../../../../../shared/worktree/types'
import { AlicornEmptyState, AlicornScreenBody, AlicornScreenHeader } from './AlicornScreenChrome'
import { groupWorktreesByStatus, projectWorktrees } from './project-worktrees'

function useProjectWork(repoIds: readonly string[]): Worktree[] {
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  return React.useMemo(
    () => projectWorktrees(worktreesByRepo as Record<string, Worktree[]>, repoIds),
    [worktreesByRepo, repoIds]
  )
}

function useOpenWorktree(): (worktreeId: string) => void {
  const setActiveWorktree = useAppStore((state) => state.setActiveWorktree)
  const setActiveView = useAppStore((state) => state.setActiveView)
  return React.useCallback(
    (worktreeId: string) => {
      setActiveWorktree(worktreeId)
      setActiveView('terminal')
    },
    [setActiveWorktree, setActiveView]
  )
}

function WorktreeCard({
  worktree,
  onOpen
}: {
  worktree: Worktree
  onOpen: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-2 w-full rounded-md border border-border bg-card p-2.5 text-left transition hover:border-foreground/20"
    >
      <div className="truncate text-[12.5px] font-medium">{worktree.displayName}</div>
      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
        {worktree.branch}
      </div>
    </button>
  )
}

export function AlicornProjectBoard({
  projectName,
  repoIds
}: {
  projectName: string
  repoIds: readonly string[]
}): React.JSX.Element {
  const worktrees = useProjectWork(repoIds)
  const statuses = useAppStore((state) => state.workspaceStatuses ?? DEFAULT_WORKSPACE_STATUSES)
  const openWorktree = useOpenWorktree()
  const columns = React.useMemo(
    () => groupWorktreesByStatus(worktrees, statuses),
    [worktrees, statuses]
  )

  return (
    <>
      <AlicornScreenHeader crumbs={['Alicorn', projectName]} title="Board" />
      <AlicornScreenBody>
        {repoIds.length === 0 ? (
          <NoRepos />
        ) : (
          <div
            className="grid items-start gap-4"
            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
          >
            {columns.map((column) => (
              <section key={column.status.id} className="rounded-xl bg-muted/40 p-2.5">
                <header className="flex items-center justify-between px-1 pb-2.5 text-xs font-semibold">
                  <span>{column.status.label}</span>
                  <span className="font-normal tabular-nums text-muted-foreground">
                    {column.worktrees.length}
                  </span>
                </header>
                {column.worktrees.map((worktree) => (
                  <WorktreeCard
                    key={worktree.id}
                    worktree={worktree}
                    onOpen={() => openWorktree(worktree.id)}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </AlicornScreenBody>
    </>
  )
}

export function AlicornProjectTasks({
  projectName,
  repoIds
}: {
  projectName: string
  repoIds: readonly string[]
}): React.JSX.Element {
  const worktrees = useProjectWork(repoIds)
  const statuses = useAppStore((state) => state.workspaceStatuses ?? DEFAULT_WORKSPACE_STATUSES)
  const openWorktree = useOpenWorktree()
  const statusLabel = React.useCallback(
    (id: string | undefined): string =>
      statuses.find((status) => status.id === id)?.label ??
      translate('auto.components.alicorn.project.noStatus', 'No status'),
    [statuses]
  )

  return (
    <>
      <AlicornScreenHeader crumbs={['Alicorn', projectName]} title="Tasks" />
      <AlicornScreenBody>
        {repoIds.length === 0 ? (
          <NoRepos />
        ) : worktrees.length === 0 ? (
          <AlicornEmptyState
            title={translate('auto.components.alicorn.project.noWorkTitle', 'Nothing in flight')}
            detail={translate(
              'auto.components.alicorn.project.noWorkDetail',
              'Every workspace under this project’s repositories appears here. Start one from the Workspaces rail.'
            )}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {worktrees.map((worktree) => (
              <li key={worktree.id}>
                <button
                  type="button"
                  onClick={() => openWorktree(worktree.id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] transition hover:bg-accent'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {worktree.displayName}
                  </span>
                  <span className="shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                    {worktree.branch}
                  </span>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {statusLabel(worktree.workspaceStatus)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </AlicornScreenBody>
    </>
  )
}

function NoRepos(): React.JSX.Element {
  return (
    <AlicornEmptyState
      title={translate('auto.components.alicorn.project.noReposTitle', 'No repositories')}
      detail={translate(
        'auto.components.alicorn.project.noReposWorkDetail',
        'Work lives in a repository. Bind one to this project and its workspaces appear here.'
      )}
    />
  )
}
