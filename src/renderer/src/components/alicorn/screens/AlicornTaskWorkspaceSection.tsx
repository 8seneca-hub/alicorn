/**
 * Where a task is being worked, and the button that starts it.
 *
 * Two states, and they are not the same question. Once a task has a session the interesting fact
 * is which workspaces it spans — a feature workspace may be several — and each of them opens in
 * the full workspace view, where the terminal, the diff and the source tree live. Before it has
 * one, the only thing worth saying is what starting will and will not do.
 */
import React from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import type { Repo } from '../../../../../shared/repo-types'
import type { TaskWorkspaceState } from './use-task-workspace'

function Caption({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

export function AlicornTaskWorkspaceSection({
  workspace,
  projectRepos,
  onOpenWorkspace
}: {
  workspace: TaskWorkspaceState
  projectRepos: readonly Repo[]
  onOpenWorkspace: (worktreeId: string) => void
}): React.JSX.Element {
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <Caption>{translate('auto.components.alicorn.task.workspace', 'Workspace')}</Caption>
      {workspace.tuples.length > 0 ? (
        <>
          {workspace.tuples.map((tuple) => {
            const repo = projectRepos.find((candidate) => candidate.id === tuple.repoId)
            return (
              <button
                key={tuple.worktreeId}
                type="button"
                onClick={() => onOpenWorkspace(tuple.worktreeId)}
                className="-mx-1.5 flex min-h-9 w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-md px-1.5 text-left text-[13px] hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {repo?.displayName ?? tuple.repoId}
                </span>
                <span className="shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                  {tuple.branch}
                </span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            )
          })}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.task.workspaceOpen',
              'Opening one shows the terminal, the diff and the source tree for it.'
            )}
          </p>
        </>
      ) : (
        <>
          <p className="max-w-[620px] text-[12.5px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.task.notStarted',
              'Not started. Starting opens a Claude session on this brief, holding Alicorn’s tools, in the project’s workspace. It makes no branch — if the work needs one, the agent creates it.'
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {projectRepos.map((repo) => (
              <Button
                key={repo.id}
                size="sm"
                variant={projectRepos.length === 1 ? 'default' : 'outline'}
                className="gap-1.5"
                disabled={workspace.starting || workspace.loading}
                onClick={() => void workspace.start(repo.id)}
              >
                {workspace.starting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {projectRepos.length === 1
                  ? translate('auto.components.alicorn.task.start', 'Start task')
                  : translate('auto.components.alicorn.task.startIn', 'Start in {{repo}}', {
                      repo: repo.displayName
                    })}
              </Button>
            ))}
          </div>
          {projectRepos.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {translate(
                'auto.components.alicorn.task.noRepoToStart',
                'This project has no repository resolved on this machine, so there is nowhere to start a session.'
              )}
            </p>
          ) : null}
        </>
      )}
      {workspace.error ? (
        <p className="mt-2 text-[11px] text-destructive">{workspace.error}</p>
      ) : null}
    </section>
  )
}
