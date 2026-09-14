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
import type { PendingQuestion } from './use-pending-questions'
import type { Project } from '../../../../../shared/alicorn/projects'
import { useAppStore } from '@/store'
import {
  AlicornEmptyState,
  AlicornScreenBody,
  AlicornScreenHeader,
  projectCrumbs
} from './AlicornScreenChrome'
import { AlicornInboxScreen } from './AlicornInboxScreen'
import { AlicornDeleteProjectDialog } from './AlicornDeleteProjectDialog'
import { AlicornNestedRepoScan } from './AlicornNestedRepoScan'
import { AlicornProjectChatScreen } from './AlicornProjectChatScreen'
import { AlicornProjectIntegrations } from './AlicornProjectIntegrations'
import { AlicornProjectAutonomy } from './AlicornProjectAutonomy'
import { AlicornNewTaskDialog } from './AlicornNewTaskDialog'
import { useAlicornProjectDir } from './use-alicorn-project-dir'
import { useProjectTasks } from './use-project-tasks'
import { useAlicornMembers } from '../shell/use-alicorn-members'
import { useProjectWorkflow } from './use-project-workflow'
import { AlicornTaskScreen } from './AlicornTaskScreen'
import { AlicornProjectBoard, AlicornProjectTasks } from './AlicornProjectWork'
import { AlicornProjectMembers } from './AlicornProjectLibrary'
import { AlicornProjectWorkflow } from './AlicornProjectWorkflowScreen'
import type { AlicornRoute, ProjectSection } from '../shell/alicorn-shell-route'

const TITLES: Record<ProjectSection, string> = {
  tasks: 'Tasks',
  board: 'Board',
  chat: 'Chat',
  inbox: 'Inbox',
  autonomy: 'Autonomy',
  integrations: 'Integrations',
  members: 'Members',
  workflow: 'Workflow',
  settings: 'Settings'
}

export function AlicornProjectScreen({
  route,
  projects,
  gates,
  questions,
  onAnswered,
  composing,
  onComposingChange,
  onResolvedGate,
  onDeleteProject,
  onNavigate
}: {
  route: { scope: 'projects'; projectId: string; section: ProjectSection; taskId?: string | null }
  projects: Project[]
  gates: PendingGateView[] | null
  /** This project's slice of the shell's one question read. */
  questions: readonly PendingQuestion[]
  onAnswered: () => void
  /** Owned by the shell so the sidebar's New task and a screen's New task open one dialog. */
  composing: boolean
  onComposingChange: (open: boolean) => void
  onResolvedGate: () => void
  onDeleteProject: (projectId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onNavigate: (next: AlicornRoute) => void
}): React.JSX.Element {
  // Tasks are read here rather than per screen: the board and the list are two readings of one set
  // of rows, and two fetches would let them disagree after a drag.
  const tasks = useProjectTasks(route.projectId)
  // Read here rather than inside a section: `.alicorn/context.md` describes the org library and the
  // project's pipeline, and both are already this screen's to know.
  const { members: orgMembers } = useAlicornMembers()
  const { workflow: defaultWorkflow } = useProjectWorkflow(route.projectId)
  const contextMembers = React.useMemo(
    () =>
      (orgMembers ?? []).map((member) => ({
        name: member.name,
        role: member.role,
        backend: member.backend
      })),
    [orgMembers]
  )
  const contextStageNames = React.useMemo(
    () => (defaultWorkflow?.stages ?? []).map((stage) => stage.name),
    [defaultWorkflow?.stages]
  )
  const repos = useAppStore((state) => state.repos)
  const setActiveView = useAppStore((state) => state.setActiveView)
  const setActiveWorktree = useAppStore((state) => state.setActiveWorktree)
  const project = projects.find((candidate) => candidate.id === route.projectId)
  const projectName = project?.name ?? route.projectId
  const [deleting, setDeleting] = React.useState(false)
  const projectRepos = repos.filter((repo) => project?.repoIds.includes(repo.id))
  // A folder has no branch, so a task working in one has no diff, no checks and no provenance.
  // The repositories inside it do — the Repositories screen offers to find them.
  const folderRepos = projectRepos.filter((repo) => repo.kind === 'folder')
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
  // Rehomed from the Context section, which no longer exists. Mounted here so the file is kept
  // current whichever section is open — inside a tab, removing the tab would have stopped the
  // writer silently and left a member reading a stale description of the project as current.
  useAlicornProjectDir(projectRepos[0]?.path ?? null, {
    projectName,
    members: contextMembers,
    stageNames: contextStageNames
  })
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
        questions={questions}
        onAnswered={onAnswered}
        onOpenTask={openTask}
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
      projectId={route.projectId}
      projectName={projectName}
      projectSource={project?.source ?? null}
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
          projectContext={project?.context ?? ''}
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

  if (route.section === 'chat') {
    return (
      <>
        <AlicornProjectChatScreen
          crumbs={crumbs}
          projectId={route.projectId}
          projectName={projectName}
          projectRepos={projectRepos}
        />
        {composer}
      </>
    )
  }

  if (route.section === 'autonomy') {
    return <AlicornProjectAutonomy crumbs={crumbs} projectId={route.projectId} />
  }

  if (route.section === 'integrations' && project) {
    return (
      <AlicornProjectIntegrations
        crumbs={crumbs}
        project={project}
        repos={projectRepos}
        onOpenTasks={() => onComposingChange(true)}
      />
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

  if (route.section === 'settings') {
    return (
      <>
        <AlicornScreenHeader crumbs={crumbs} title={TITLES.settings} />
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
          {folderRepos.map((folder) => (
            <AlicornNestedRepoScan
              key={folder.id}
              folder={folder}
              onImported={() =>
                onNavigate({ scope: 'projects', projectId: route.projectId, section: 'settings' })
              }
            />
          ))}
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
      <AlicornProjectTasks {...workProps} onSwitchView={() => section('board')} />
      {composer}
    </>
  )
}
