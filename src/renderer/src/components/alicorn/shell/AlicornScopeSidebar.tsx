/**
 * The sidebar, which changes completely with the scope.
 *
 * Three different lists, not one list with things hidden: the org scope must not be able to show
 * a project's name, and the surest way to guarantee that is for it never to hold one.
 */
import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { Project } from '../../../../../shared/alicorn/projects'
import {
  ORG_SECTIONS,
  PROJECT_SECTIONS,
  type AlicornRoute,
  type OrgSection,
  type ProjectSection
} from './alicorn-shell-route'

const PROJECT_SECTION_LABELS: Record<ProjectSection, string> = {
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

const ORG_SECTION_LABELS: Record<OrgSection, string> = {
  members: 'Members',
  workflows: 'Workflows',
  checks: 'Required Checks'
}

function SidebarHead({ name, kind }: { name: string; kind: string }): React.JSX.Element {
  return (
    <div className="shrink-0 px-4 pb-2 pt-4">
      <div className="text-[15px] font-semibold">{name}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{kind}</div>
    </div>
  )
}

function Item({
  label,
  active,
  meta,
  onClick
}: {
  label: string
  active: boolean
  meta?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]',
        active ? 'bg-accent font-semibold text-foreground' : 'hover:bg-accent'
      )}
    >
      <span className="truncate">{label}</span>
      {meta ? <span className="ml-auto text-[11px] text-muted-foreground">{meta}</span> : null}
    </button>
  )
}

export function AlicornScopeSidebar({
  route,
  projects,
  waitingByProject,
  onNavigate
}: {
  route: AlicornRoute
  projects: Project[]
  waitingByProject: Record<string, number>
  onNavigate: (next: AlicornRoute) => void
}): React.JSX.Element {
  if (route.scope === 'inbox') {
    return (
      <aside className="flex w-[272px] shrink-0 flex-col border-r border-border bg-sidebar">
        <SidebarHead
          name={translate('auto.components.alicorn.shell.inbox', 'Inbox')}
          kind={translate('auto.components.alicorn.shell.inboxKind', 'Across every project')}
        />
        <div className="scrollbar-sleek flex-1 overflow-y-auto px-2 pb-4">
          {projects.map((project) => (
            <Item
              key={project.id}
              label={project.name}
              active={false}
              meta={String(waitingByProject[project.id] ?? 0)}
              onClick={() =>
                onNavigate({ scope: 'projects', projectId: project.id, section: 'inbox' })
              }
            />
          ))}
        </div>
      </aside>
    )
  }

  if (route.scope === 'org') {
    return (
      <aside className="flex w-[272px] shrink-0 flex-col border-r border-border bg-sidebar">
        <SidebarHead
          name={translate('auto.components.alicorn.shell.organisation', 'Organisation')}
          kind={translate(
            'auto.components.alicorn.shell.organisationKind',
            'The library — nothing runs here'
          )}
        />
        <div className="scrollbar-sleek flex-1 overflow-y-auto px-2 pb-4">
          {ORG_SECTIONS.map((section) => (
            <Item
              key={section}
              label={ORG_SECTION_LABELS[section]}
              active={route.section === section}
              onClick={() => onNavigate({ scope: 'org', section })}
            />
          ))}
        </div>
      </aside>
    )
  }

  if (route.projectId === null) {
    return (
      <aside className="flex w-[272px] shrink-0 flex-col border-r border-border bg-sidebar">
        <SidebarHead
          name={translate('auto.components.alicorn.shell.projects', 'Projects')}
          kind={translate(
            'auto.components.alicorn.shell.projectsKind',
            'Run at once, on one org library'
          )}
        />
        <div className="scrollbar-sleek flex-1 overflow-y-auto px-2 pb-4">
          {projects.map((project) => (
            <Item
              key={project.id}
              label={project.name}
              active={false}
              meta={project.key}
              onClick={() =>
                onNavigate({ scope: 'projects', projectId: project.id, section: 'overview' })
              }
            />
          ))}
        </div>
      </aside>
    )
  }

  const project = projects.find((candidate) => candidate.id === route.projectId)
  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-border bg-sidebar">
      <SidebarHead
        name={project?.name ?? route.projectId}
        kind={translate('auto.components.alicorn.shell.projectKind', 'Project')}
      />
      <div className="scrollbar-sleek flex-1 overflow-y-auto px-2 pb-4">
        {PROJECT_SECTIONS.map((section) => (
          <Item
            key={section}
            label={PROJECT_SECTION_LABELS[section]}
            active={route.section === section}
            meta={
              section === 'inbox' && (waitingByProject[route.projectId] ?? 0) > 0
                ? String(waitingByProject[route.projectId])
                : undefined
            }
            onClick={() => onNavigate({ scope: 'projects', projectId: route.projectId, section })}
          />
        ))}
      </div>
      <div className="shrink-0 border-t border-border p-2">
        <Item
          label={translate('auto.components.alicorn.shell.allProjects', 'All projects')}
          active={false}
          onClick={() => onNavigate({ scope: 'projects', projectId: null })}
        />
      </div>
    </aside>
  )
}
