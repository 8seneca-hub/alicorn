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
import { McpConfigSection } from '../../settings/McpConfigSection'
import { useAppStore } from '@/store'
import { AlicornEmptyState, AlicornScreenBody, AlicornScreenHeader } from './AlicornScreenChrome'
import { AlicornInboxScreen } from './AlicornInboxScreen'
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
  mcp: 'MCP Servers',
  repos: 'Repositories'
}

export function AlicornProjectScreen({
  route,
  projects,
  gates,
  onResolvedGate,
  onNavigate
}: {
  route: { scope: 'projects'; projectId: string; section: ProjectSection }
  projects: Project[]
  gates: PendingGateView[] | null
  onResolvedGate: () => void
  onNavigate: (next: AlicornRoute) => void
}): React.JSX.Element {
  const repos = useAppStore((state) => state.repos)
  const project = projects.find((candidate) => candidate.id === route.projectId)
  const projectName = project?.name ?? route.projectId
  const projectRepos = repos.filter((repo) => project?.repoIds.includes(repo.id))
  const projectGates = (gates ?? []).filter(
    (gate) => gate.repoId !== null && (project?.repoIds ?? []).includes(gate.repoId)
  )

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

  if (route.section === 'board') {
    return <AlicornProjectBoard projectName={projectName} repoIds={project?.repoIds ?? []} />
  }

  if (route.section === 'tasks') {
    return <AlicornProjectTasks projectName={projectName} repoIds={project?.repoIds ?? []} />
  }

  if (route.section === 'members') {
    return <AlicornProjectMembers projectName={projectName} />
  }

  if (route.section === 'workflow') {
    return <AlicornProjectWorkflow projectName={projectName} projectId={route.projectId} />
  }

  if (route.section === 'checks') {
    return <AlicornProjectChecks projectName={projectName} projectId={route.projectId} />
  }

  if (route.section === 'mcp') {
    const target = projectRepos[0]
    return (
      <>
        <AlicornScreenHeader crumbs={['Alicorn', projectName]} title={TITLES.mcp} />
        <AlicornScreenBody>
          {target ? (
            <McpConfigSection repo={target} />
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

  if (route.section === 'repos') {
    return (
      <>
        <AlicornScreenHeader crumbs={['Alicorn', projectName]} title={TITLES.repos} />
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
      <AlicornScreenHeader crumbs={['Alicorn', projectName]} title={TITLES.overview} />
      <AlicornScreenBody>
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          <OverviewTile
            label={translate('auto.components.alicorn.project.waiting', 'Waiting on you')}
            value={String(projectGates.length)}
            onClick={() =>
              onNavigate({ scope: 'projects', projectId: route.projectId, section: 'inbox' })
            }
          />
          <OverviewTile
            label={translate('auto.components.alicorn.projects.repos', 'Repos')}
            value={String(projectRepos.length)}
            onClick={() =>
              onNavigate({ scope: 'projects', projectId: route.projectId, section: 'repos' })
            }
          />
          <OverviewTile
            label={translate('auto.components.alicorn.projects.key', 'Key')}
            value={project?.key ?? '—'}
          />
        </div>
      </AlicornScreenBody>
    </>
  )
}

function OverviewTile({
  label,
  value,
  onClick
}: {
  label: string
  value: string
  onClick?: () => void
}): React.JSX.Element {
  const className =
    'rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-foreground/20'
  const body = (
    <>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}
