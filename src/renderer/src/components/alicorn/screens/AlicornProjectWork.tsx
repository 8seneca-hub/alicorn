/**
 * Board and Tasks: two readings of the same rows, and the rows are tasks.
 *
 * They were worktrees, which was wrong in a way that showed: a board column held a repository
 * name, and a task nobody had started yet could not appear at all. A task is the unit of work
 * (PRODUCT-ARCHITECTURE §2); the `(repo, branch, worktree)` tuples it binds are how it is being
 * worked on, and they live in the client's orchestration SQLite — no renderer bridge reads them
 * yet, so neither screen claims a repository count or a per-task spend it cannot source.
 */
import React from 'react'
import { Kanban, List, Plus, Share2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../../shared/workspace-status-defaults'
import type { Task } from '../../../../../shared/alicorn/tasks'
import { taskRef } from '../../../../../shared/alicorn/tasks'
import {
  AlicornEmptyState,
  AlicornScreenBody,
  AlicornScreenHeader,
  projectCrumbs
} from './AlicornScreenChrome'
import type { ProjectTasksState } from './use-project-tasks'

type WorkScreenProps = {
  projectName: string
  projectKey: string
  state: ProjectTasksState
  onAllProjects: () => void
  onNewTask: () => void
  onOpenTask: (taskId: string) => void
  onSwitchView: () => void
}

function useBoardColumns(): readonly { id: string; label: string }[] {
  const statuses = useAppStore((state) => state.workspaceStatuses ?? DEFAULT_WORKSPACE_STATUSES)
  return statuses
}

function StrategyBadge({ task }: { task: Task }): React.JSX.Element | null {
  if (task.executionStrategy !== 'orchestrated') {
    return null
  }
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
      <Share2 className="size-3" />
      {task.executionStrategy}
    </span>
  )
}

function TaskCard({
  task,
  projectKey,
  onOpen,
  onDragStart
}: {
  task: Task
  projectKey: string
  onOpen: () => void
  onDragStart: () => void
}): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className="mb-2 w-full cursor-pointer rounded-lg border border-border bg-card p-2.5 text-left transition hover:border-foreground/20"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {taskRef(projectKey, task.number)}
        </span>
        <StrategyBadge task={task} />
      </div>
      <div className="mt-1 text-[12.5px] font-medium">{task.title}</div>
      {task.stageKey ? (
        <div className="mt-2 text-[11px] text-muted-foreground">{task.stageKey}</div>
      ) : null}
    </div>
  )
}

function WorkHeader({
  title,
  props,
  switchLabel,
  SwitchIcon
}: {
  title: string
  props: WorkScreenProps
  switchLabel: string
  SwitchIcon: typeof List
}): React.JSX.Element {
  return (
    <AlicornScreenHeader
      crumbs={projectCrumbs(props.projectName, props.onAllProjects)}
      title={title}
      actions={
        <>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={props.onSwitchView}>
            <SwitchIcon className="size-3.5" />
            {switchLabel}
          </Button>
          <Button size="sm" className="gap-1.5" onClick={props.onNewTask}>
            <Plus className="size-3.5" />
            {translate('auto.components.alicorn.project.newTask', 'New task')}
          </Button>
        </>
      }
    />
  )
}

function TasksUnavailable({ error }: { error: string }): React.JSX.Element {
  return (
    <AlicornEmptyState
      title={translate('auto.components.alicorn.task.errorTitle', 'Tasks could not be read')}
      detail={error}
    />
  )
}

export function AlicornProjectBoard(props: WorkScreenProps): React.JSX.Element {
  const columns = useBoardColumns()
  const { state } = props
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [over, setOver] = React.useState<string | null>(null)

  const drop = (columnId: string): void => {
    setOver(null)
    const taskId = dragging
    setDragging(null)
    if (!taskId) {
      return
    }
    const task = state.tasks.find((candidate) => candidate.id === taskId)
    if (!task || task.column === columnId) {
      return
    }
    void state.update(taskId, { column: columnId })
  }

  return (
    <>
      <WorkHeader
        title={translate('auto.components.alicorn.project.board', 'Board')}
        props={props}
        switchLabel={translate('auto.components.alicorn.project.list', 'List')}
        SwitchIcon={List}
      />
      <AlicornScreenBody>
        {state.error ? (
          <TasksUnavailable error={state.error} />
        ) : (
          <div
            className="grid items-start gap-4"
            style={{
              // Columns keep their share on a desktop and wrap to one per row on a phone, rather
              // than forcing the board into a horizontal scroll it never recovers from.
              gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 220px), 1fr))`,
              gridTemplateRows: 'auto'
            }}
            data-column-count={columns.length}
          >
            {columns.map((column) => {
              const inColumn = state.tasks.filter((task) => task.column === column.id)
              return (
                <section
                  key={column.id}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setOver(column.id)
                  }}
                  onDragLeave={() => setOver((current) => (current === column.id ? null : current))}
                  onDrop={() => drop(column.id)}
                  className={cn(
                    'rounded-xl bg-muted/40 p-2.5 transition',
                    over === column.id && 'ring-1 ring-foreground/20'
                  )}
                >
                  <header className="flex items-center justify-between px-1 pb-2.5 text-xs font-semibold">
                    <span>{column.label}</span>
                    <span className="font-normal tabular-nums text-muted-foreground">
                      {inColumn.length}
                    </span>
                  </header>
                  {inColumn.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      projectKey={props.projectKey}
                      onOpen={() => props.onOpenTask(task.id)}
                      onDragStart={() => setDragging(task.id)}
                    />
                  ))}
                </section>
              )
            })}
          </div>
        )}
      </AlicornScreenBody>
    </>
  )
}

export function AlicornProjectTasks(props: WorkScreenProps): React.JSX.Element {
  const columns = useBoardColumns()
  const { state } = props
  const columnLabel = (id: string): string =>
    columns.find((column) => column.id === id)?.label ?? id

  return (
    <>
      <WorkHeader
        title={translate('auto.components.alicorn.project.tasks', 'Tasks')}
        props={props}
        switchLabel={translate('auto.components.alicorn.project.board', 'Board')}
        SwitchIcon={Kanban}
      />
      <AlicornScreenBody>
        {state.error ? (
          <TasksUnavailable error={state.error} />
        ) : state.loading ? (
          <p className="text-sm text-muted-foreground">
            {translate('auto.components.alicorn.task.loading', 'Reading tasks…')}
          </p>
        ) : state.tasks.length === 0 ? (
          <AlicornEmptyState
            title={translate('auto.components.alicorn.task.emptyTitle', 'No tasks yet')}
            detail={translate(
              'auto.components.alicorn.task.emptyDetail',
              'A task is the unit of work — the thing you open, name, assign and finish. It binds the repositories it needs rather than being one of them.'
            )}
            action={
              <Button size="sm" className="mt-3 gap-1.5" onClick={props.onNewTask}>
                <Plus className="size-3.5" />
                {translate('auto.components.alicorn.project.newTask', 'New task')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">
                    {translate('auto.components.alicorn.task.id', 'ID')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {translate('auto.components.alicorn.task.title', 'Title')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {translate('auto.components.alicorn.task.column', 'Column')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {translate('auto.components.alicorn.task.strategy', 'Strategy')}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {translate('auto.components.alicorn.task.stage', 'Stage')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.tasks.map((task) => (
                  <tr
                    key={task.id}
                    onClick={() => props.onOpenTask(task.id)}
                    className="cursor-pointer border-b border-border last:border-b-0 hover:bg-accent"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] text-muted-foreground">
                      {taskRef(props.projectKey, task.number)}
                    </td>
                    <td className="px-3 py-2">{task.title}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {columnLabel(task.column)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {task.executionStrategy}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {task.stageKey ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AlicornScreenBody>
    </>
  )
}
