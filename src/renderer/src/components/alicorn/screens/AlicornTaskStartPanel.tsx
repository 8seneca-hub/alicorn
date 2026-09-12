/**
 * What a task shows before its session exists.
 *
 * Once the session is open this screen is the conversation, so everything that is not the
 * conversation has to live here: the brief someone wrote, the column the ticket sits in, and the
 * control that opens the session. After it opens, the brief is the first message and the column
 * moves with the board.
 */
import React from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../../shared/workspace-status-defaults'
import { Button } from '@/components/ui/button'
import type { Repo } from '../../../../../shared/repo-types'
import type { Task } from '../../../../../shared/alicorn/tasks'
import type { ProjectTasksState } from './use-project-tasks'
import type { TaskWorkspaceState } from './use-task-workspace'

function Caption({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

export function AlicornTaskStartPanel({
  workspace,
  task,
  tasks,
  projectRepos,
  onOpenWorkspace
}: {
  workspace: TaskWorkspaceState
  task: Task
  tasks: ProjectTasksState
  projectRepos: readonly Repo[]
  onOpenWorkspace: (worktreeId: string) => void
}): React.JSX.Element {
  const columns = useAppStore((state) => state.workspaceStatuses ?? DEFAULT_WORKSPACE_STATUSES)

  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-9 pb-12 pt-6">
      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-1 basis-[320px] rounded-xl border border-border bg-card p-4">
          <Caption>{translate('auto.components.alicorn.newTask.context', 'Context')}</Caption>
          {task.context.trim() ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{task.context}</p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              {translate(
                'auto.components.alicorn.task.noContext',
                'No context was written. Everything the agent knows about this task, it will have to read off the repository.'
              )}
            </p>
          )}
        </section>

        <section className="w-full shrink-0 rounded-xl border border-border bg-card p-4 sm:w-[280px]">
          <Caption>{translate('auto.components.alicorn.task.column', 'Column')}</Caption>
          <div className="flex flex-col gap-1">
            {columns.map((column) => (
              <button
                key={column.id}
                type="button"
                onClick={() => void tasks.update(task.id, { column: column.id })}
                className={cn(
                  'flex h-8 items-center rounded-md px-2 text-left text-[12.5px] transition',
                  task.column === column.id
                    ? 'bg-accent font-semibold'
                    : 'text-muted-foreground hover:bg-accent'
                )}
              >
                {column.label}
              </button>
            ))}
          </div>
        </section>
      </div>

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
                'Not started. Starting opens a Claude session on this brief, holding Alicorn\u2019s tools, in the project\u2019s workspace. It makes no branch \u2014 if the work needs one, the agent creates it.'
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
    </div>
  )
}
