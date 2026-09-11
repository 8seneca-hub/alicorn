/**
 * One project, section by section.
 *
 * Sections that have a real implementation render it; the rest say plainly what is not built yet
 * rather than drawing a convincing shell over nothing. A screen that looks finished and does
 * nothing is worse than one that admits the gap — it costs a bug report to discover.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import type { PendingGateView } from '../../../../../shared/alicorn/gate-review'
import type { Project } from '../../../../../shared/alicorn/projects'
import type { RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import { McpConfigSection } from '../../settings/McpConfigSection'
import { useAppStore } from '@/store'
import {
  AlicornEmptyState,
  AlicornScreenBody,
  AlicornScreenHeader,
  projectCrumbs
} from './AlicornScreenChrome'
import { AlicornInboxScreen } from './AlicornInboxScreen'
import { AlicornMcpAttachCard } from './AlicornMcpAttachCard'
import { AlicornNewTaskDialog } from './AlicornNewTaskDialog'
import { useProjectTasks } from './use-project-tasks'
import { AlicornProjectOverview } from './AlicornProjectOverview'
import { AlicornTaskScreen } from './AlicornTaskScreen'
import { AlicornProjectBoard, AlicornProjectTasks } from './AlicornProjectWork'
import {
  AlicornProjectChecks,
  AlicornProjectMembers,
  AlicornProjectWorkflow
} from './AlicornProjectLibrary'
import type { AlicornRoute, ProjectSection } from '../shell/alicorn-shell-route'

const TITLES: Record<ProjectSection, string> = {
  overview: 'Overview',
  board: 'Board',
  tasks: 'Tasks',
  inbox: 'Inbox',
  members: 'Members',
  workflow: 'Workflow',
  checks: 'Required Checks',
  skills: 'Skills',
  mcp: 'MCP Servers',
  integrations: 'Integrations',
  repos: 'Repositories',
  chat: 'Chat'
}

export function AlicornProjectScreen({
  route,
  projects,
  gates,
  spend,
  composing,
  onComposingChange,
  onResolvedGate,
  onNavigate
}: {
  route: { scope: 'projects'; projectId: string; section: ProjectSection; taskId?: string | null }
  projects: Project[]
  gates: PendingGateView[] | null
  spend: RunCostSummary
  /** Owned by the shell so the sidebar's New task and a screen's New task open one dialog. */
  composing: boolean
  onComposingChange: (open: boolean) => void
  onResolvedGate: () => void
  onNavigate: (next: AlicornRoute) => void
}): React.JSX.Element {
  // Tasks are read here rather than per screen: the board, the list and the overview are three
  // readings of one set of rows, and three fetches would let them disagree after a drag.
  const tasks = useProjectTasks(route.projectId)
  const repos = useAppStore((state) => state.repos)
  const setActiveView = useAppStore((state) => state.setActiveView)
  const setActiveWorktree = useAppStore((state) => state.setActiveWorktree)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const project = projects.find((candidate) => candidate.id === route.projectId)
  const projectName = project?.name ?? route.projectId
  const projectRepos = repos.filter((repo) => project?.repoIds.includes(repo.id))
  const projectGates = (gates ?? []).filter(
    (gate) => gate.repoId !== null && (project?.repoIds ?? []).includes(gate.repoId)
  )
  const allProjects = (): void => onNavigate({ scope: 'projects', projectId: null })
  const crumbs = projectCrumbs(projectName, allProjects)
  const section = (next: ProjectSection): void =>
    onNavigate({ scope: 'projects', projectId: route.projectId, section: next })
  const openWorkspace = (worktreeId: string): void => {
    setActiveWorktree(worktreeId)
    setActiveView('terminal')
  }
  const openTask = (taskId: string): void =>
    onNavigate({ scope: 'projects', projectId: route.projectId, section: route.section, taskId })
  const closeTask = (): void =>
    onNavigate({ scope: 'projects', projectId: route.projectId, section: route.section })

  if (route.section === 'inbox') {
    return (
      <AlicornInboxScreen
        gates={projectGates}
        onResolved={onResolvedGate}
        projectId={route.projectId}
        projectName={projectName}
      />
    )
  }

  const workProps = {
    projectName,
    projectKey: project?.key ?? '',
    state: tasks,
    onAllProjects: allProjects,
    onNewTask: () => onComposingChange(true),
    onOpenTask: (taskId: string) => openTask(taskId)
  }
  const composer = (
    <AlicornNewTaskDialog
      open={composing}
      onOpenChange={onComposingChange}
      projectName={projectName}
      projectRepos={projectRepos}
      onCreate={tasks.create}
      onCreated={openTask}
    />
  )

  const openTaskRow = route.taskId
    ? tasks.tasks.find((candidate) => candidate.id === route.taskId)
    : undefined
  if (openTaskRow) {
    return (
      <>
        <AlicornTaskScreen
          task={openTaskRow}
          projectId={route.projectId}
          projectKey={project?.key ?? ''}
          projectRepos={projectRepos}
          tasks={tasks}
          crumbs={crumbs}
          onBack={closeTask}
          onOpenWorkspace={openWorkspace}
        />
        {composer}
      </>
    )
  }

  if (route.section === 'board') {
    return (
      <>
        <AlicornProjectBoard {...workProps} onSwitchView={() => section('tasks')} />
        {composer}
      </>
    )
  }

  if (route.section === 'tasks') {
    return (
      <>
        <AlicornProjectTasks {...workProps} onSwitchView={() => section('board')} />
        {composer}
      </>
    )
  }

  if (route.section === 'members') {
    return <AlicornProjectMembers projectName={projectName} onAllProjects={allProjects} />
  }

  if (route.section === 'workflow') {
    return (
      <AlicornProjectWorkflow
        projectName={projectName}
        projectId={route.projectId}
        onAllProjects={allProjects}
      />
    )
  }

  if (route.section === 'checks') {
    return (
      <AlicornProjectChecks
        projectName={projectName}
        projectId={route.projectId}
        onAllProjects={allProjects}
      />
    )
  }

  if (route.section === 'mcp') {
    const target = projectRepos[0]
    return (
      <>
        <AlicornScreenHeader crumbs={crumbs} title={TITLES.mcp} />
        <AlicornScreenBody>
          {target ? (
            <>
              <AlicornMcpAttachCard repo={target} />
              <McpConfigSection repo={target} />
            </>
          ) : (
            <AlicornEmptyState
              title={translate(
                'auto.components.alicorn.project.mcpNoRepoTitle',
                'No repository bound'
              )}
              detail={translate(
                'auto.components.alicorn.project.mcpNoRepoDetail',
                'MCP servers are configured in a repository the agent works in, so this project needs one bound before it has a config to hold.'
              )}
            />
          )}
        </AlicornScreenBody>
      </>
    )
  }

  if (route.section === 'skills') {
    return (
      <>
        <AlicornScreenHeader crumbs={crumbs} title={TITLES.skills} />
        <AlicornScreenBody>
          <AlicornEmptyState
            title={translate(
              'auto.components.alicorn.project.skillsTitle',
              'Skills are a member’s, not a project’s'
            )}
            detail={translate(
              'auto.components.alicorn.project.skillsDetail',
              'A skill set is bound to a member in the org library, and the catalogue lives in the Skills view. Choosing which of them this project may use is not built yet.'
            )}
            action={
              <button
                type="button"
                onClick={() => setActiveView('skills')}
                className="mt-3 h-8 rounded-md border border-border px-3 text-[12.5px] font-medium transition hover:bg-accent"
              >
                {translate(
                  'auto.components.alicorn.project.openSkills',
                  'Open the skill catalogue'
                )}
              </button>
            }
          />
        </AlicornScreenBody>
      </>
    )
  }

  if (route.section === 'integrations') {
    return (
      <>
        <AlicornScreenHeader crumbs={crumbs} title={TITLES.integrations} />
        <AlicornScreenBody>
          <AlicornEmptyState
            title={translate(
              'auto.components.alicorn.project.integrationsTitle',
              'Connected per device, not per project'
            )}
            detail={translate(
              'auto.components.alicorn.project.integrationsDetail',
              'Linear, GitHub and the other providers are connected in Settings, and a task picks up whatever is connected there. Scoping a connection to one project is not built yet.'
            )}
            action={
              <button
                type="button"
                onClick={() => openSettingsPage()}
                className="mt-3 h-8 rounded-md border border-border px-3 text-[12.5px] font-medium transition hover:bg-accent"
              >
                {translate(
                  'auto.components.alicorn.project.openConnections',
                  'Open connected accounts'
                )}
              </button>
            }
          />
        </AlicornScreenBody>
      </>
    )
  }

  if (route.section === 'chat') {
    return (
      <>
        <AlicornScreenHeader crumbs={crumbs} title={TITLES.chat} />
        <AlicornScreenBody>
          <AlicornEmptyState
            title={translate(
              'auto.components.alicorn.project.chatTitle',
              'Chat belongs to a session'
            )}
            detail={translate(
              'auto.components.alicorn.project.chatDetail',
              'Every workspace has its own agent chat, and a new task opens one. A project-wide chat that can drive the board in words is not built yet.'
            )}
            action={
              <button
                type="button"
                onClick={() => onComposingChange(true)}
                className="mt-3 h-8 rounded-md border border-border px-3 text-[12.5px] font-medium transition hover:bg-accent"
              >
                {translate('auto.components.alicorn.project.newTask', 'New task')}
              </button>
            }
          />
        </AlicornScreenBody>
        {composer}
      </>
    )
  }

  if (route.section === 'repos') {
    return (
      <>
        <AlicornScreenHeader crumbs={crumbs} title={TITLES.repos} />
        <AlicornScreenBody>
          {projectRepos.length === 0 ? (
            <AlicornEmptyState
              title={translate('auto.components.alicorn.project.noReposTitle', 'No repositories')}
              detail={translate(
                'auto.components.alicorn.project.noReposDetail',
                'A project owns the repositories one feature may span. Bind them when you create the project; editing the set from here is not built yet.'
              )}
            />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {projectRepos.map((repo) => (
                <li key={repo.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                  <span className="truncate font-medium">{repo.displayName}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {repo.path}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AlicornScreenBody>
      </>
    )
  }

  return (
    <>
      <AlicornProjectOverview
        project={project}
        projectId={route.projectId}
        projectName={projectName}
        gates={projectGates}
        spend={spend}
        repos={repos}
        onNavigate={onNavigate}
        onNewTask={() => onComposingChange(true)}
        tasks={tasks}
      />
      {composer}
    </>
  )
}
