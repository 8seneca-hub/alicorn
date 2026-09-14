/**
 * The Alicorn shell: rail, a sidebar that changes with the scope, and the main region.
 *
 * It is a top-level view of its own rather than a rewrite of the workspace shell. The two answer
 * different questions — this one is "what is the state of my projects", the workspace shell is
 * "what is this agent doing right now" — and keeping them separate is what lets this exist before
 * the tab model is re-keyed rather than after it.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useRunCostByDispatch } from '@/hooks/useAlicornRunCost'
import type { RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import type { Worktree } from '../../../../../shared/worktree/types'
import { projectWorktrees } from '../screens/project-worktrees'
import { summarizeProjectRunCost } from '../screens/project-run-cost'
import { openTaskCounts, useTasksByProject } from '../screens/use-tasks-by-project'
import { usePendingQuestions, type QuestionSubject } from '../screens/use-pending-questions'
import { useGatePanelState } from '../../right-sidebar/gate-panel/use-gate-panel-state'
import { AlicornScopeSidebar } from './AlicornScopeSidebar'
import { AlicornProjectsScreen } from '../screens/AlicornProjectsScreen'
import { AlicornProjectScreen } from '../screens/AlicornProjectScreen'
import { AlicornOrgScreen } from '../screens/AlicornOrgScreen'
import { AlicornInboxScreen } from '../screens/AlicornInboxScreen'
import { AlicornAssistant, AlicornAssistantTrigger } from '../assistant/AlicornAssistant'
import {
  assistantScopeForRoute,
  setAlicornAssistantScope
} from '../assistant/alicorn-assistant-store'
import {
  ALICORN_ASSISTANT_SHORTCUT_LABEL,
  useAlicornAssistantShortcut
} from '../assistant/use-alicorn-assistant-shortcut'
import { useAlicornProjects } from './use-alicorn-projects'
import { useSyncExternalStore } from 'react'
import {
  getAlicornNewProjectOpen,
  setAlicornNewProjectOpen,
  subscribeAlicornNewProject
} from './alicorn-new-project-store'
import {
  ALICORN_HOME,
  DEFAULT_PROJECT_SECTION,
  isProjectRoute,
  type AlicornRoute
} from './alicorn-shell-route'

export function AlicornShell(): React.JSX.Element {
  const scope = useAppStore((state) => state.alicornScope)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((state) => state.agentStatusByPaneKey)
  const costs = useRunCostByDispatch()
  const [route, setRoute] = React.useState<AlicornRoute>(ALICORN_HOME)
  const [filter, setFilter] = React.useState('')
  // Onboarding ends by opening this, so the flag lives where both can reach it.
  const creating = useSyncExternalStore(
    subscribeAlicornNewProject,
    getAlicornNewProjectOpen,
    getAlicornNewProjectOpen
  )
  const setCreating = setAlicornNewProjectOpen
  const [importing, setImporting] = React.useState(false)
  // The task composer is the shell's so the sidebar's New task and the board's open one dialog.
  const [composingTask, setComposingTask] = React.useState(false)
  // The rail owns the scope; this shell owns where you are inside it. Re-pointing the rail resets
  // the route to that scope's landing place rather than leaving you on a stale project section.
  React.useEffect(() => {
    setRoute(
      scope === 'inbox'
        ? { scope: 'inbox' }
        : scope === 'org'
          ? { scope: 'org', section: 'members' }
          : ALICORN_HOME
    )
  }, [scope])

  /**
   * A task opened from the command palette.
   *
   * Declared after the scope reset above and never before it: the palette sets the scope to
   * `projects` on its way here, and the reset effect fires on that change. React runs effects in
   * declaration order, so putting this first would have the reset stomp the route it just set.
   */
  const pendingTask = useAppStore((state) => state.pendingAlicornTask)
  const clearPendingTask = useAppStore((state) => state.clearPendingAlicornTask)
  React.useEffect(() => {
    if (!pendingTask) {
      return
    }
    setRoute({
      scope: 'projects',
      projectId: pendingTask.projectId,
      section: 'tasks',
      taskId: pendingTask.taskId
    })
    clearPendingTask()
  }, [clearPendingTask, pendingTask])

  const projectsState = useAlicornProjects()
  const { gates, refresh: refreshGates } = useGatePanelState({ isVisible: true })

  // Read here rather than inside the inbox, because three surfaces need the same answer: the
  // cross-project inbox, a project's own inbox, and the rail's waiting count. One read, filtered.
  const tasksByProject = useTasksByProject(projectsState.projects)
  const questionSubjects = React.useMemo<QuestionSubject[]>(
    () =>
      projectsState.projects.flatMap((project) =>
        (tasksByProject[project.id] ?? []).map((task) => ({
          task,
          projectId: project.id,
          projectKey: project.key
        }))
      ),
    [projectsState.projects, tasksByProject]
  )
  const { questions, reload: reloadQuestions } = usePendingQuestions(questionSubjects)

  // Counted per repository, then folded onto the project that owns it. A gate nothing places
  // belongs to no project and is therefore counted in none of them. Questions are counted too:
  // both mean "something is waiting on me", and a rail that showed only gates read as clear while
  // an agent sat blocked on a question.
  const waitingByProject = React.useMemo(() => {
    const byRepo: Record<string, number> = {}
    for (const gate of gates ?? []) {
      if (gate.repoId === null) {
        continue
      }
      byRepo[gate.repoId] = (byRepo[gate.repoId] ?? 0) + 1
    }
    const questionsByProject: Record<string, number> = {}
    for (const question of questions) {
      questionsByProject[question.projectId] = (questionsByProject[question.projectId] ?? 0) + 1
    }
    const byProject: Record<string, number> = {}
    for (const project of projectsState.projects) {
      byProject[project.id] =
        project.repoIds.reduce((total, repoId) => total + (byRepo[repoId] ?? 0), 0) +
        (questionsByProject[project.id] ?? 0)
    }
    return byProject
  }, [gates, projectsState.projects, questions])

  // A project's worktrees, which is what its spend is summed over — a dispatch belongs to a pane,
  // a pane to a tab, and a tab to a worktree. Open work is counted from tasks, not from these.
  const worktreesByProject = React.useMemo(() => {
    const byProject: Record<string, Worktree[]> = {}
    for (const project of projectsState.projects) {
      byProject[project.id] = projectWorktrees(
        worktreesByRepo as Record<string, Worktree[]>,
        project.repoIds
      )
    }
    return byProject
  }, [projectsState.projects, worktreesByRepo])

  const openByProject = React.useMemo(() => openTaskCounts(tasksByProject), [tasksByProject])

  // Summed here rather than per card, so the sidebar subtitle and the Spend card can never
  // disagree about what a project has cost.
  const spendByProject = React.useMemo(() => {
    const byProject: Record<string, RunCostSummary> = {}
    for (const [projectId, worktrees] of Object.entries(worktreesByProject)) {
      byProject[projectId] = summarizeProjectRunCost({
        worktreeIds: worktrees.map((worktree) => worktree.id),
        tabsByWorktree,
        agentStatusByPaneKey,
        costs
      })
    }
    return byProject
  }, [worktreesByProject, tabsByWorktree, agentStatusByPaneKey, costs])

  const visibleProjects = React.useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle
      ? projectsState.projects.filter((project) => project.name.toLowerCase().includes(needle))
      : projectsState.projects
  }, [projectsState.projects, filter])

  // The assistant follows the user rather than being navigated to, so the route it is standing in
  // front of is pushed to it from here — the one place that always knows.
  useAlicornAssistantShortcut()
  React.useEffect(() => {
    const project = isProjectRoute(route)
      ? projectsState.projects.find((candidate) => candidate.id === route.projectId)
      : undefined
    setAlicornAssistantScope(assistantScopeForRoute(route, project?.name ?? null, null))
  }, [route, projectsState.projects])

  return (
    <div className="flex h-full min-h-0 w-full">
      <AlicornScopeSidebar
        route={route}
        projects={visibleProjects}
        waitingByProject={waitingByProject}
        openByProject={openByProject}
        spendByProject={spendByProject}
        filter={filter}
        onFilterChange={setFilter}
        onNewProject={() => setCreating(true)}
        onNewTask={() => setComposingTask(true)}
        onNavigate={setRoute}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {route.scope === 'inbox' ? (
          <AlicornInboxScreen
            gates={gates}
            onResolved={refreshGates}
            projectId={null}
            questions={questions}
            onAnswered={reloadQuestions}
            onOpenTask={(taskId) => {
              const owner = questions.find((question) => question.taskId === taskId)
              if (owner) {
                setRoute({
                  scope: 'projects',
                  projectId: owner.projectId,
                  section: 'tasks',
                  taskId
                })
              }
            }}
          />
        ) : route.scope === 'org' ? (
          <AlicornOrgScreen section={route.section} projects={projectsState.projects} />
        ) : isProjectRoute(route) ? (
          <AlicornProjectScreen
            route={route}
            projects={projectsState.projects}
            gates={gates}
            questions={questions.filter((question) => question.projectId === route.projectId)}
            onAnswered={reloadQuestions}
            composing={composingTask}
            onComposingChange={setComposingTask}
            onResolvedGate={refreshGates}
            onDeleteProject={projectsState.remove}
            onProjectsChanged={projectsState.reload}
            onNavigate={setRoute}
          />
        ) : (
          <AlicornProjectsScreen
            state={projectsState}
            projects={visibleProjects}
            waitingByProject={waitingByProject}
            openByProject={openByProject}
            spendByProject={spendByProject}
            creating={creating}
            onCreatingChange={setCreating}
            importing={importing}
            onImportingChange={setImporting}
            onOpen={(projectId) =>
              setRoute({ scope: 'projects', projectId, section: DEFAULT_PROJECT_SECTION })
            }
          />
        )}
      </main>
      <AlicornAssistant projects={projectsState.projects} />
      <AlicornAssistantTrigger shortcutLabel={ALICORN_ASSISTANT_SHORTCUT_LABEL} />
    </div>
  )
}

export function AlicornShellUnavailableNotice({ detail }: { detail: string }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      <div className="max-w-sm space-y-2">
        <p className="font-medium text-foreground">
          {translate(
            'auto.components.alicorn.shell.unreachableTitle',
            'The control plane is not reachable'
          )}
        </p>
        <p>
          {translate(
            'auto.components.alicorn.shell.unreachableBody',
            'Projects, members and workflows live there. Start the local stack, or point ALICORN_CONTROL_API_URL at one.'
          )}
        </p>
        <p className="font-mono text-[11px]">{detail}</p>
      </div>
    </div>
  )
}
