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
import type { Worktree } from '../../../../../shared/worktree/types'
import { projectWorktrees } from '../screens/project-worktrees'
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
  const [route, setRoute] = React.useState<AlicornRoute>(ALICORN_HOME)
  const [filter, setFilter] = React.useState('')
  const [creating, setCreating] = React.useState(false)
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

  // Open work per project, so the sidebar can say "4 open · 2 repos" without each card counting
  // it again. A worktree is the unit — it is what Orca actually has in flight.
  const openByProject = React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const project of projectsState.projects) {
      counts[project.id] = projectWorktrees(
        worktreesByRepo as Record<string, Worktree[]>,
        project.repoIds
      ).length
    }
    return counts
  }, [projectsState.projects, worktreesByRepo])

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
        filter={filter}
        onFilterChange={setFilter}
        onNewProject={() => setCreating(true)}
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
            onResolvedGate={refreshGates}
            onNavigate={setRoute}
          />
        ) : (
          <AlicornProjectsScreen
            state={projectsState}
            projects={visibleProjects}
            waitingByProject={waitingByProject}
            openByProject={openByProject}
            creating={creating}
            onCreatingChange={setCreating}
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
