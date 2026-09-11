/**
 * One task: what it is, where it is in the workflow, and who is on it.
 *
 * The prototype's task session also carries a live chat log and the execute panel. Those need a
 * session, and a session needs the task bound to a `(repo, branch, worktree)` tuple — which no
 * renderer bridge writes yet. So this screen is the half that is real: the ticket, its stage, its
 * people, and the controls that actually persist. It says plainly what is missing instead of
 * drawing a chat that could never receive a message.
 */
import React from 'react'
import { Check, Circle, ExternalLink, Loader2, Play, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../../shared/workspace-status-defaults'
import { useAppStore } from '@/store'
import type { Task } from '../../../../../shared/alicorn/tasks'
import { taskRef } from '../../../../../shared/alicorn/tasks'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'
import { Button } from '@/components/ui/button'
import type { Repo } from '../../../../../shared/repo-types'
import { useAlicornMembers } from '../shell/use-alicorn-members'
import { useTaskWorkspace } from './use-task-workspace'
import { useProjectWorkflow } from './use-project-workflow'
import { AlicornScreenBody, AlicornScreenHeader, type AlicornCrumb } from './AlicornScreenChrome'
import type { ProjectTasksState } from './use-project-tasks'

function Caption({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

/** Done / current / still to come, from the stage's position relative to the task's. */
function stageState(
  stages: readonly WorkflowStage[],
  stageKey: string | null,
  stage: WorkflowStage
): 'done' | 'current' | 'todo' {
  if (!stageKey) {
    return 'todo'
  }
  if (stage.key === stageKey) {
    return 'current'
  }
  const current = stages.findIndex((candidate) => candidate.key === stageKey)
  const mine = stages.findIndex((candidate) => candidate.key === stage.key)
  return current !== -1 && mine !== -1 && mine < current ? 'done' : 'todo'
}

export function AlicornTaskScreen({
  task,
  projectId,
  projectKey,
  projectRepos,
  tasks,
  crumbs,
  onBack,
  onOpenWorkspace
}: {
  task: Task
  projectId: string
  projectKey: string
  projectRepos: readonly Repo[]
  tasks: ProjectTasksState
  crumbs: AlicornCrumb[]
  onBack: () => void
  onOpenWorkspace: (worktreeId: string) => void
}): React.JSX.Element {
  const columns = useAppStore((state) => state.workspaceStatuses ?? DEFAULT_WORKSPACE_STATUSES)
  const { workflow } = useProjectWorkflow(projectId)
  const { members } = useAlicornMembers()
  const stages = workflow?.stages ?? []
  const workspace = useTaskWorkspace(task, projectKey)
  const bound = (members ?? []).filter((member) => task.memberIds.includes(member.id))

  return (
    <>
      <AlicornScreenHeader
        crumbs={crumbs}
        title={`${taskRef(projectKey, task.number)} · ${task.title}`}
        onBack={onBack}
        actions={
          <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
            {task.executionStrategy === 'orchestrated' ? <Share2 className="size-3" /> : null}
            {task.executionStrategy}
          </span>
        }
      />
      <AlicornScreenBody>
        {stages.length > 0 ? (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {stages.map((stage) => {
              const state = stageState(stages, task.stageKey, stage)
              return (
                <span
                  key={stage.key}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]',
                    state === 'current'
                      ? 'border-foreground/30 font-semibold text-foreground'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  {state === 'done' ? (
                    <Check className="size-3" />
                  ) : state === 'current' ? (
                    <Play className="size-3" />
                  ) : (
                    <Circle className="size-3" />
                  )}
                  {stage.name}
                </span>
              )
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-start gap-4">
          <section className="min-w-[320px] flex-1 rounded-xl border border-border bg-card p-4">
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

          <section className="w-[280px] shrink-0 rounded-xl border border-border bg-card p-4">
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

            <div className="my-3 h-px bg-border" />
            <Caption>{translate('auto.components.alicorn.newTask.members', 'Members')}</Caption>
            {bound.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                {translate('auto.components.alicorn.task.noMembers', 'Nobody yet.')}
              </p>
            ) : (
              bound.map((member) => (
                <div key={member.id} className="flex min-h-7 items-center gap-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate">{member.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {member.backend}
                  </span>
                </div>
              ))
            )}
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
                  'auto.components.alicorn.task.workspaceBound',
                  'Opening one shows the session working on it.'
                )}
              </p>
            </>
          ) : (
            <>
              <p className="max-w-[620px] text-[12.5px] text-muted-foreground">
                {translate(
                  'auto.components.alicorn.task.notStarted',
                  'Not started. Starting gives this task its own branch and workspace, and everything that runs in it is attributed back here.'
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {projectRepos.map((repo) => (
                  <Button
                    key={repo.id}
                    size="sm"
                    variant={projectRepos.length === 1 ? 'default' : 'outline'}
                    className="gap-1.5"
                    disabled={workspace.starting}
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
                    'This project has no repository resolved on this machine, so there is nowhere to start it.'
                  )}
                </p>
              ) : null}
              {workspace.error ? (
                <p className="mt-2 text-[11px] text-destructive">{workspace.error}</p>
              ) : null}
            </>
          )}
        </section>
      </AlicornScreenBody>
    </>
  )
}
