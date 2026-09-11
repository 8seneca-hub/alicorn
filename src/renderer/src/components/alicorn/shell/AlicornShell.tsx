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
import { useOpenTaskCounts } from '../screens/use-open-task-counts'
import { useGatePanelState } from '../../right-sidebar/gate-panel/use-gate-panel-state'
import { AlicornScopeSidebar } from './AlicornScopeSidebar'
import { AlicornProjectsScreen } from '../screens/AlicornProjectsScreen'
import { AlicornProjectScreen } from '../screens/AlicornProjectScreen'
import { AlicornOrgScreen } from '../screens/AlicornOrgScreen'
import { AlicornInboxScreen } from '../screens/AlicornInboxScreen'
import { useAlicornProjects } from './use-alicorn-projects'
import { ALICORN_HOME, isProjectRoute, type AlicornRoute } from './alicorn-shell-route'

export function AlicornShell(): React.JSX.Element {
  const scope = useAppStore((state) => state.alicornScope)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((state) => state.agentStatusByPaneKey)
  const costs = useRunCostByDispatch()
  const [route, setRoute] = React.useState<AlicornRoute>(ALICORN_HOME)
  const [filter, setFilter] = React.useState('')
  const [creating, setCreating] = React.useState(false)
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
  const projectsState = useAlicornProjects()
  const { gates, refresh: refreshGates } = useGatePanelState({ isVisible: true })

  // Counted per repository, then folded onto the project that owns it. A gate nothing places
  // belongs to no project and is therefore counted in none of them.
  const waitingByProject = React.useMemo(() => {
    const byRepo: Record<string, number> = {}
    for (const gate of gates ?? []) {
      if (gate.repoId === null) {
        continue
      }
      byRepo[gate.repoId] = (byRepo[gate.repoId] ?? 0) + 1
    }
    const byProject: Record<string, number> = {}
    for (const project of projectsState.projects) {
      byProject[project.id] = project.repoIds.reduce(
        (total, repoId) => total + (byRepo[repoId] ?? 0),
        0
      )
    }
    return byProject
  }, [gates, projectsState.projects])

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

  // Open work is open *tasks*: a project with three tickets and no branch yet has three, and a
  // repository is not one of them.
  const openByProject = useOpenTaskCounts(projectsState.projects)

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
          <AlicornInboxScreen gates={gates} onResolved={refreshGates} projectId={null} />
        ) : route.scope === 'org' ? (
          <AlicornOrgScreen section={route.section} />
        ) : isProjectRoute(route) ? (
          <AlicornProjectScreen
            route={route}
            projects={projectsState.projects}
            gates={gates}
            spend={
              spendByProject[route.projectId] ?? {
                costUsd: null,
                partial: false
              }
            }
            composing={composingTask}
            onComposingChange={setComposingTask}
            onResolvedGate={refreshGates}
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
            onOpen={(projectId) => setRoute({ scope: 'projects', projectId, section: 'overview' })}
          />
        )}
      </main>
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
