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
import { AlicornTaskStartPanel } from './AlicornTaskStartPanel'
import { useProjectWorkflow } from './use-project-workflow'
import type { TaskSessionActivity } from './task-session-activity'
import type { AlicornCrumb } from './AlicornScreenChrome'
import type { ProjectTasksState } from './use-project-tasks'

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
  const { workflow } = useProjectWorkflow(projectId)
  const { members } = useAlicornMembers()
  const projectRepoIds = React.useMemo(() => projectRepos.map((repo) => repo.id), [projectRepos])
  const workspace = useTaskWorkspace(task, projectKey, projectRepoIds)
  const sessionRepoId = workspace.repoId
  const bound = (members ?? []).filter((member) => task.memberIds.includes(member.id))
  // The member the session runs as is the task's first — the author the plan picked.
  const working = bound.find((member) => member.id === task.memberIds[0]) ?? null
  const [activity, setActivity] = React.useState<TaskSessionActivity>('offline')

  return (
    <>
      <AlicornTaskHeader
        task={task}
        projectKey={projectKey}
        crumbs={crumbs}
        stages={workflow?.stages ?? []}
        members={bound}
        activity={workspace.session ? activity : 'offline'}
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
          memberName={working?.name ?? null}
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
    </>
  )
}
