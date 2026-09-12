/**
 * One task: the session working it, and everything that session is working from.
 *
 * The chat is the screen, not a panel on it — PRODUCT-ARCHITECTURE §2 makes the task the thing you
 * open, and what you open a ticket to do is talk to whoever is on it. The brief, the stage, the
 * column and the members sit underneath, because they are what the conversation is about.
 *
 * Before anyone has started it there is no session, so the same space carries the one control that
 * makes one.
 */
import React from 'react'
import { Check, Circle, Play, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../../shared/workspace-status-defaults'
import { useAppStore } from '@/store'
import type { Task } from '../../../../../shared/alicorn/tasks'
import { taskRef } from '../../../../../shared/alicorn/tasks'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'
import type { Repo } from '../../../../../shared/repo-types'
import { useAlicornMembers } from '../shell/use-alicorn-members'
import { useTaskWorkspace } from './use-task-workspace'
import { AlicornTaskChat } from './AlicornTaskChat'
import { AlicornTaskWorkspaceSection } from './AlicornTaskWorkspaceSection'
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
  const projectRepoIds = React.useMemo(() => projectRepos.map((repo) => repo.id), [projectRepos])
  const workspace = useTaskWorkspace(task, projectKey, projectRepoIds)
  const bound = (members ?? []).filter((member) => task.memberIds.includes(member.id))
  const sessionRepoId = workspace.repoId

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

        {workspace.session ? (
          <AlicornTaskChat
            session={workspace.session}
            className="mb-6 h-[min(58vh,600px)]"
            {...(sessionRepoId ? { onRestart: () => void workspace.start(sessionRepoId) } : {})}
          />
        ) : null}

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

        <AlicornTaskWorkspaceSection
          workspace={workspace}
          projectRepos={projectRepos}
          onOpenWorkspace={onOpenWorkspace}
        />
      </AlicornScreenBody>
    </>
  )
}
