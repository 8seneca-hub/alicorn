/**
 * The sidebar, which changes completely with the scope.
 *
 * Three different lists, not one list with things hidden: the org scope must not be able to show
 * a project's name, and the surest way to guarantee that is for it never to hold one.
 */
import React from 'react'
import {
  BookText,
  ChevronLeft,
  Gauge,
  Settings2,
  Inbox,
  LayoutGrid,
  List,
  Plus,
  Search,
  Server,
  ShieldCheck,
  SquareKanban,
  Users,
  Workflow
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatRunCostSummary, type RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import type { Project } from '../../../../../shared/alicorn/projects'
import {
  DEFAULT_PROJECT_SECTION,
  ORG_SECTIONS,
  PROJECT_SECTIONS,
  type AlicornRoute,
  type OrgSection,
  type ProjectSection
} from './alicorn-shell-route'

type IconComponent = typeof Inbox

const PROJECT_SECTION_LABELS: Record<ProjectSection, string> = {
  tasks: 'Tasks',
  board: 'Board',
  context: 'Context',
  inbox: 'Inbox',
  members: 'Members',
  workflow: 'Workflow',
  checks: 'Required Checks',
  mcp: 'MCP Servers',
  settings: 'Settings'
}

const PROJECT_SECTION_ICONS: Record<ProjectSection, IconComponent> = {
  tasks: List,
  board: SquareKanban,
  context: BookText,
  inbox: Inbox,
  members: Users,
  workflow: Workflow,
  checks: ShieldCheck,
  mcp: Server,
  settings: Settings2
}

const ORG_SECTION_LABELS: Record<OrgSection, string> = {
  members: 'Members',
  workflows: 'Workflows',
  autonomy: 'Autonomy'
}

const ORG_SECTION_ICONS: Record<OrgSection, IconComponent> = {
  members: Users,
  workflows: Workflow,
  autonomy: Gauge
}

function SidebarHead({ name, kind }: { name: string; kind: string }): React.JSX.Element {
  return (
    <div className="shrink-0 px-4 pb-2.5 pt-4">
      <div className="truncate text-[15px] font-semibold">{name}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{kind}</div>
    </div>
  )
}

function Item({
  label,
  Icon,
  active,
  meta,
  metaAttention,
  onClick
}: {
  label: string
  Icon: IconComponent
  active: boolean
  meta?: string
  metaAttention?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-8 w-full items-center gap-[9px] rounded-md px-2 text-left text-[13px]',
        active ? 'bg-accent font-semibold text-foreground' : 'hover:bg-accent'
      )}
    >
      <Icon
        className={cn('size-[15px] shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
      />
      <span className="truncate">{label}</span>
      {meta ? (
        <span
          className={cn(
            'ml-auto text-[11px]',
            metaAttention
              ? 'font-bold text-status-attention'
              : active
                ? 'text-foreground'
                : 'text-muted-foreground'
          )}
        >
          {meta}
        </span>
      ) : null}
    </button>
  )
}

function Aside({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <aside className="flex w-40 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar sm:w-[272px]">
      {children}
    </aside>
  )
}

export function AlicornScopeSidebar({
  route,
  projects,
  waitingByProject,
  openByProject,
  spendByProject,
  filter,
  onFilterChange,
  onNewProject,
  onNewTask,
  onNavigate
}: {
  route: AlicornRoute
  projects: Project[]
  waitingByProject: Record<string, number>
  openByProject: Record<string, number>
  spendByProject: Record<string, RunCostSummary>
  filter: string
  onFilterChange: (value: string) => void
  onNewProject: () => void
  onNewTask: (projectId: string) => void
  onNavigate: (next: AlicornRoute) => void
}): React.JSX.Element {
  if (route.scope === 'inbox') {
    return (
      <Aside>
        <SidebarHead
          name={translate('auto.components.alicorn.shell.inbox', 'Inbox')}
          kind={translate('auto.components.alicorn.shell.inboxKind', 'Across every project')}
        />
        <div className="scrollbar-sleek flex-1 overflow-y-auto px-2 pb-4">
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {translate('auto.components.alicorn.shell.ownInbox', 'Open its own inbox')}
          </div>
          {projects.map((project) => (
            <Item
              key={project.id}
              label={project.name}
              Icon={LayoutGrid}
              active={false}
              meta={String(waitingByProject[project.id] ?? 0)}
              metaAttention={(waitingByProject[project.id] ?? 0) > 0}
              onClick={() =>
                onNavigate({ scope: 'projects', projectId: project.id, section: 'inbox' })
              }
            />
          ))}
        </div>
      </Aside>
    )
  }

  if (route.scope === 'org') {
    return (
      <Aside>
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
              Icon={ORG_SECTION_ICONS[section]}
              active={route.section === section}
              onClick={() => onNavigate({ scope: 'org', section })}
            />
          ))}
        </div>
      </Aside>
    )
  }

  if (route.projectId === null) {
    return (
      <Aside>
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
                onNavigate({
                  scope: 'projects',
                  projectId: project.id,
                  section: DEFAULT_PROJECT_SECTION
                })
              }
              className="mb-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-foreground/20"
            >
              <div className="truncate text-[13px] font-semibold">{project.name}</div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">
                  {translate(
                    'auto.components.alicorn.shell.projectMeta',
                    '{{open}} open · {{repos}} repos',
                    { open: openByProject[project.id] ?? 0, repos: project.repoIds.length }
                  )}
                </span>
                <span className="shrink-0 font-mono">
                  {formatRunCostSummary(
                    spendByProject[project.id] ?? { costUsd: null, partial: false }
                  )}
                </span>
              </div>
            </button>
          ))}
        </div>
        <div className="shrink-0 border-t border-border p-2.5">
          <button
            type="button"
            onClick={onNewProject}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border text-[12.5px] font-medium transition hover:bg-accent"
          >
            <Plus className="size-3.5" />
            {translate('auto.components.alicorn.projects.new', 'New project')}
          </button>
        </div>
      </Aside>
    )
  }

  const projectId = route.projectId
  const project = projects.find((candidate) => candidate.id === projectId)
  const waiting = waitingByProject[projectId] ?? 0
  const open = openByProject[projectId] ?? 0
  return (
    <Aside>
      <SidebarHead
        name={project?.name ?? projectId}
        kind={translate('auto.components.alicorn.shell.projectKind', 'Project · {{spend}} spent', {
          spend: formatRunCostSummary(
            spendByProject[projectId] ?? { costUsd: null, partial: false }
          )
        })}
      />
      <div className="scrollbar-sleek flex-1 overflow-y-auto px-2 pb-4">
        {PROJECT_SECTIONS.map((section) => (
          <Item
            key={section}
            label={PROJECT_SECTION_LABELS[section]}
            Icon={PROJECT_SECTION_ICONS[section]}
            // A task detail belongs to no section — you may have reached it from the board or from
            // the list, and highlighting whichever you came through says you are still there.
            active={route.taskId == null && route.section === section}
            meta={
              section === 'inbox' && waiting > 0
                ? String(waiting)
                : section === 'tasks' && open > 0
                  ? String(open)
                  : undefined
            }
            metaAttention={section === 'inbox'}
            onClick={() => onNavigate({ scope: 'projects', projectId, section })}
          />
        ))}
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-border p-2.5">
        <button
          type="button"
          onClick={() => onNewTask(projectId)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-[12.5px] font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <Plus className="size-3.5" />
          {translate('auto.components.alicorn.project.newTask', 'New task')}
        </button>
        <button
          type="button"
          onClick={() => onNavigate({ scope: 'projects', projectId: null })}
          className="flex h-8 w-full items-center justify-center gap-1 rounded-md text-[12.5px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          {translate('auto.components.alicorn.shell.allProjects', 'All projects')}
        </button>
      </div>
    </Aside>
  )
}
