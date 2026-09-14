/**
 * One task: the session working it.
 *
 * The chat is the screen, not a panel on it — PRODUCT-ARCHITECTURE §2 makes the task the thing you
 * open, and what you open a ticket to do is talk to whoever is on it. So the header carries the
 * facts that frame the conversation (where it is in the workflow, who is on it, what it has cost)
 * and the session takes every remaining pixel.
 *
 * The brief is not repeated as a card below. It is the session's first message, and a second copy
 * of it on the same screen is a second thing to keep in sync.
 */
import React from 'react'
import type { Task } from '../../../../../shared/alicorn/tasks'
import type { Repo } from '../../../../../shared/repo-types'
import { useAlicornMembers } from '../shell/use-alicorn-members'
import { useTaskWorkspace } from './use-task-workspace'
import { AlicornTaskChat } from './AlicornTaskChat'
import { AlicornTaskHeader } from './AlicornTaskHeader'
import { AlicornTaskMembers } from './AlicornTaskMembers'
import { AlicornTaskStartPanel } from './AlicornTaskStartPanel'
import { useProjectWorkflow } from './use-project-workflow'
import type { TaskSessionActivity } from './task-session-activity'
import type { AlicornCrumb } from './AlicornScreenChrome'
import type { ProjectTasksState } from './use-project-tasks'

export function AlicornTaskScreen({
  task,
  projectId,
  projectKey,
  projectContext,
  projectRepos,
  tasks,
  crumbs,
  onBack,
  onOpenWorkspace
}: {
  task: Task
  projectId: string
  projectKey: string
  /** The project's own context, carried into the brief this task opens on. */
  projectContext: string
  projectRepos: readonly Repo[]
  tasks: ProjectTasksState
  crumbs: AlicornCrumb[]
  onBack: () => void
  onOpenWorkspace: (worktreeId: string) => void
}): React.JSX.Element {
  // The task's own workflow. A task with none has no rail at all, which is the honest drawing of
  // a raw session: there are no stages to be at.
  const { workflow, loading: workflowLoading } = useProjectWorkflow(projectId, task.workflowId)
  const taskWorkflow = task.workflowId === null ? null : workflow
  const { members, error: membersError } = useAlicornMembers()
  const projectRepoIds = React.useMemo(() => projectRepos.map((repo) => repo.id), [projectRepos])
  const bound = (members ?? []).filter((member) => task.memberIds.includes(member.id))
  // The member the session runs as is the task's first — the author the plan picked. It has to be
  // resolved before the workspace hook, which launches as that member.
  const working = bound.find((member) => member.id === task.memberIds[0]) ?? null
  // Both reads have to have answered before the session opens, because the brief is written once
  // and a null here is "not read yet", not "none". A refused read counts as answered: waiting on a
  // read that already failed would leave the ticket unopenable rather than merely underinformed.
  const briefReady =
    (members !== null || membersError !== null) && (task.workflowId === null || !workflowLoading)
  const workspace = useTaskWorkspace(
    task,
    projectKey,
    projectRepoIds,
    projectContext,
    working,
    taskWorkflow,
    briefReady
  )
  const sessionRepoId = workspace.repoId
  const [activity, setActivity] = React.useState<TaskSessionActivity>('offline')

  return (
    <>
      <AlicornTaskHeader
        task={task}
        projectKey={projectKey}
        crumbs={crumbs}
        stages={taskWorkflow?.stages ?? []}
        // Null, never a guessed zero: cost attribution covers the backends Alicorn prices, and a
        // task nobody has spent on has no figure rather than a figure of nothing.
        spentUsd={null}
        budgetUsd={null}
        onBack={onBack}
        onEscalate={() => void tasks.update(task.id, { executionStrategy: 'orchestrated' })}
      />

      {workspace.session ? (
        <AlicornTaskChat
          session={workspace.session}
          onActivityChange={setActivity}
          {...(sessionRepoId ? { onRestart: () => void workspace.start(sessionRepoId) } : {})}
        />
      ) : (
        <AlicornTaskStartPanel
          workspace={workspace}
          task={task}
          tasks={tasks}
          projectRepos={projectRepos}
          onOpenWorkspace={onOpenWorkspace}
        />
      )}

      <AlicornTaskMembers
        members={bound}
        runningMemberId={task.memberIds[0]}
        activity={workspace.session ? activity : 'offline'}
      />
    </>
  )
}
