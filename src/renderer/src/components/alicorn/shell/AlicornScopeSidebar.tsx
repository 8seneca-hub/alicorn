/**
 * The sidebar, which changes completely with the scope.
 *
 * Three different lists, not one list with things hidden: the org scope must not be able to show
 * a project's name, and the surest way to guarantee that is for it never to hold one.
 */
import React from 'react'
import { Plus, Search } from 'lucide-react'
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
  openByProject,
  filter,
  onFilterChange,
  onNewProject,
  onNavigate
}: {
  route: AlicornRoute
  projects: Project[]
  waitingByProject: Record<string, number>
  openByProject: Record<string, number>
  filter: string
  onFilterChange: (value: string) => void
  onNewProject: () => void
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
            '{{count}} running at once, one org library',
            { count: projects.length }
          )}
        />
        <label className="mx-4 mb-1 mt-2 flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder={translate('auto.components.alicorn.shell.findProject', 'Find a project…')}
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="scrollbar-sleek flex-1 overflow-y-auto px-2 pb-4 pt-1">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() =>
                onNavigate({ scope: 'projects', projectId: project.id, section: 'overview' })
              }
              className="mb-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-foreground/20"
            >
              <div className="truncate text-[13px] font-semibold">{project.name}</div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {translate(
                    'auto.components.alicorn.shell.projectMeta',
                    '{{open}} open · {{repos}} repos',
                    { open: openByProject[project.id] ?? 0, repos: project.repoIds.length }
                  )}
                </span>
                <span className="font-mono">{project.key}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            onClick={onNewProject}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border text-[13px] font-medium transition hover:bg-accent"
          >
            <Plus className="size-3.5" />
            {translate('auto.components.alicorn.projects.new', 'New project')}
          </button>
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
