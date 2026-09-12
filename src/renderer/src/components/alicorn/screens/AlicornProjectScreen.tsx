/**
 * One project, section by section.
 *
 * Sections that have a real implementation render it; the rest say plainly what is not built yet
 * rather than drawing a convincing shell over nothing. A screen that looks finished and does
 * nothing is worse than one that admits the gap — it costs a bug report to discover.
 */
import React from 'react'
import { Button } from '@/components/ui/button'
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
import { AlicornDeleteProjectDialog } from './AlicornDeleteProjectDialog'
import { AlicornMcpAttachCard } from './AlicornMcpAttachCard'
import {
  AlicornProjectIntegrationsSection,
  AlicornProjectSkillsSection
} from './AlicornProjectPlaceholderSections'
import { AlicornNewTaskDialog } from './AlicornNewTaskDialog'
import { useProjectChat } from './use-project-chat'
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
  onDeleteProject,
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
  onDeleteProject: (projectId: string) => Promise<{ ok: true } | { ok: false; error: string }>
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
  const chat = useProjectChat(project)
  const [deleting, setDeleting] = React.useState(false)
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
  const deleteDialog = (
    <AlicornDeleteProjectDialog
      project={deleting ? (project ?? null) : null}
      openTaskCount={tasks.tasks.filter((row) => row.column !== 'completed').length}
      onOpenChange={(open) => setDeleting(open)}
      onDelete={onDeleteProject}
      onDeleted={allProjects}
    />
  )
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
      <AlicornProjectSkillsSection crumbs={crumbs} onOpenSkills={() => setActiveView('skills')} />
    )
  }

  if (route.section === 'integrations') {
    return (
      <AlicornProjectIntegrationsSection
        crumbs={crumbs}
        onOpenConnections={() => openSettingsPage()}
      />
    )
  }

  if (route.section === 'chat') {
    return (
      <>
        <AlicornScreenHeader crumbs={crumbs} title={TITLES.chat} />
        <AlicornScreenBody>
          <section className="max-w-[640px] rounded-xl border border-border bg-card p-4">
            <p className="text-[13px] leading-relaxed">
              {translate(
                'auto.components.alicorn.project.chatIntro',
                'A Claude session that can see and change this project in words — its board, its tasks, and the members it draws on. Every change it makes answers with a receipt saying what it did and how to undo it.'
              )}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {chat.worktree ? (
                <button
                  type="button"
                  onClick={chat.open}
                  className="h-8 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  {translate('auto.components.alicorn.project.openChat', 'Open the project chat')}
                </button>
              ) : (
                projectRepos.map((repo) => (
                  <button
                    key={repo.id}
                    type="button"
                    disabled={chat.starting}
                    onClick={() => void chat.start(repo.id)}
                    className="h-8 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                  >
                    {projectRepos.length === 1
                      ? translate(
                          'auto.components.alicorn.project.startChat',
                          'Start the project chat'
                        )
                      : translate(
                          'auto.components.alicorn.project.startChatIn',
                          'Start it in {{repo}}',
                          { repo: repo.displayName }
                        )}
                  </button>
                ))
              )}
            </div>
            {projectRepos.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {translate(
                  'auto.components.alicorn.project.chatNoRepo',
                  'A session needs somewhere to run, and this project has no repository resolved on this machine.'
                )}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {translate(
                  'auto.components.alicorn.project.chatIsWorkspace',
                  'It opens as an ordinary workspace, so it keeps session resume, splits and the side panels.'
                )}
              </p>
            )}
            {chat.error ? <p className="mt-2 text-[11px] text-destructive">{chat.error}</p> : null}
          </section>
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
          <section className="mt-8 rounded-xl border border-destructive/30 p-4">
            <h2 className="text-[13px] font-semibold">
              {translate('auto.components.alicorn.project.deleteTitle', 'Delete this project')}
            </h2>
            <p className="mt-1 max-w-[560px] text-[12.5px] text-muted-foreground">
              {translate(
                'auto.components.alicorn.project.deleteDetail',
                'Its board goes with it. The repositories above are only unbound — nothing on disk is touched.'
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setDeleting(true)}
            >
              {translate('auto.components.alicorn.project.deleteAction', 'Delete project…')}
            </Button>
          </section>
        </AlicornScreenBody>
        {deleteDialog}
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
