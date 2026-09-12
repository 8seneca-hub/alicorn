/**
 * One project at a glance: what needs you, what is running, what it has cost, and the rules the
 * work runs under.
 *
 * Every figure here is read from something that already exists — gates from the gate queue, tasks
 * from the control plane, cost from the run-cost store, stages and members from the control plane.
 * Where a number is not knowable yet it says so; a plausible-looking figure on this screen would
 * be worse than a dash, because this is the screen a developer decides from.
 */
import React from 'react'
import { AlertTriangle, Lock, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { formatRunCostSummary, type RunCostSummary } from '../../../../../shared/alicorn/run-cost'
import type { PendingGateView } from '../../../../../shared/alicorn/gate-review'
import type { Project } from '../../../../../shared/alicorn/projects'
import type { Repo } from '../../../../../shared/repo-types'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'
import { useAlicornMembers } from '../shell/use-alicorn-members'
import { useProjectWorkflow } from './use-project-workflow'
import { taskRef } from '../../../../../shared/alicorn/tasks'
import type { ProjectTasksState } from './use-project-tasks'
import { AlicornScreenBody, AlicornScreenHeader } from './AlicornScreenChrome'
import type { AlicornRoute, ProjectSection } from '../shell/alicorn-shell-route'

/** `execution_strategy`'s values are vocabulary, not copy — CLAUDE.md names them, so they are
 *  shown verbatim and never localised. */
const EXECUTION_STRATEGIES = ['single', 'orchestrated'] as const

/** The board column a task is in while someone is working on it. */
const IN_PROGRESS_COLUMN = 'in-progress'

function Caption({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function Card({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-4', className)}>
      {children}
    </section>
  )
}

function Badge({
  children,
  tone
}: {
  children: React.ReactNode
  tone?: 'attention'
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[11px]',
        tone === 'attention'
          ? 'flex items-center gap-1 border-status-attention/40 bg-status-attention/10 text-status-attention'
          : 'border-border text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

function Row({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex min-h-9 items-center gap-2.5 text-[13px]">{children}</div>
}

export function AlicornProjectOverview({
  project,
  projectId,
  projectName,
  gates,
  spend,
  repos,
  tasks,
  onNavigate,
  onNewTask
}: {
  project: Project | undefined
  projectId: string
  projectName: string
  gates: PendingGateView[]
  spend: RunCostSummary
  repos: readonly Repo[]
  tasks: ProjectTasksState
  onNavigate: (next: AlicornRoute) => void
  onNewTask: () => void
}): React.JSX.Element {
  const projectKey = project?.key ?? ''
  const running = tasks.tasks.filter((task) => task.column === IN_PROGRESS_COLUMN)
  const { workflow, loading: workflowLoading } = useProjectWorkflow(projectId)
  const { members } = useAlicornMembers()
  const section = (next: ProjectSection): void =>
    onNavigate({ scope: 'projects', projectId, section: next })

  return (
    <>
      <AlicornScreenHeader
        crumbs={[
          {
            label: translate('auto.components.alicorn.shell.projects', 'Projects'),
            onClick: () => onNavigate({ scope: 'projects', projectId: null })
          },
          projectName
        ]}
        title={translate('auto.components.alicorn.project.overview', 'Overview')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={onNewTask}>
            <Plus className="size-3.5" />
            {translate('auto.components.alicorn.project.newTask', 'New task')}
          </Button>
        }
      />
      <AlicornScreenBody>
        {gates.length > 0 ? (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-status-attention/40 bg-status-attention/10 px-4 py-3 text-[13px]">
            <AlertTriangle className="size-4 shrink-0 text-status-attention" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold">
                {gates.length === 1
                  ? translate('auto.components.alicorn.project.needsYouOne', 'One item needs you.')
                  : translate(
                      'auto.components.alicorn.project.needsYou',
                      '{{count}} items need you.',
                      { count: gates.length }
                    )}
              </span>{' '}
              <span className="text-muted-foreground">{gates[0]?.question}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => section('inbox')}>
              {translate('auto.components.alicorn.project.openInbox', 'Open inbox')}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-stretch gap-4">
          <Card className="min-w-0 flex-1 basis-[320px]">
            <Caption>
              {translate('auto.components.alicorn.project.runningNow', 'Running now')}
            </Caption>
            {running.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                {translate(
                  'auto.components.alicorn.project.nothingRunning',
                  'Nothing in progress. A task moves here when it is picked up on the board.'
                )}
              </p>
            ) : (
              running.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => section('tasks')}
                  className="-mx-1.5 flex min-h-9 w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-md px-1.5 text-left text-[13px] hover:bg-accent"
                >
                  <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {taskRef(projectKey, task.number)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                  {task.stageKey ? <Badge>{task.stageKey}</Badge> : null}
                </button>
              ))
            )}
          </Card>

          <Card className="w-full shrink-0 sm:w-[280px]">
            <Caption>{translate('auto.components.alicorn.project.spend', 'Spend')}</Caption>
            <div className="font-mono text-[22px] font-semibold tabular-nums">
              {formatRunCostSummary(spend)}
            </div>
            <div className="text-[12.5px] text-muted-foreground">
              {translate('auto.components.alicorn.project.acrossTasks', 'across {{count}} tasks', {
                count: tasks.tasks.length
              })}
            </div>
            <div className="my-3 h-px bg-border" />
            <Caption>
              {translate('auto.components.alicorn.project.executionStrategy', 'Execution strategy')}
            </Caption>
            {EXECUTION_STRATEGIES.map((strategy) => (
              <div
                key={strategy}
                className="mt-1 flex items-center justify-between text-[12.5px] first:mt-0"
              >
                <span>{strategy}</span>
                <span className="font-mono tabular-nums">
                  {tasks.tasks.filter((task) => task.executionStrategy === strategy).length}
                </span>
              </div>
            ))}
          </Card>
        </div>

        <section className="mt-6">
          <h2 className="text-base font-semibold">
            {workflow
              ? translate('auto.components.alicorn.project.workflowNamed', 'Workflow · {{name}}', {
                  name: workflow.name
                })
              : translate('auto.components.alicorn.project.workflow', 'Workflow')}
          </h2>
          <p className="mt-1 max-w-[620px] text-[12.5px] text-muted-foreground">
            {translate(
              'auto.components.alicorn.project.workflowIntro',
              'Required checks, reversibility and inherited cost are authored per stage by an org admin — never by the member a stage judges.'
            )}
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            {workflowLoading ? (
              <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
                {translate('auto.components.alicorn.project.workflowLoading', 'Reading workflows…')}
              </div>
            ) : !workflow || workflow.stages.length === 0 ? (
              <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
                {translate(
                  'auto.components.alicorn.project.noWorkflowDetail',
                  'A workflow is optional. Without one a task is still a task — it just has no stage to hand off at.'
                )}
              </div>
            ) : (
              workflow.stages.map((stage) => (
                <button
                  key={stage.key}
                  type="button"
                  onClick={() => section('workflow')}
                  className="flex w-full items-center gap-2.5 border-b border-border px-4 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-accent"
                >
                  <StageRow stage={stage} />
                </button>
              ))
            )}
          </div>
        </section>

        <div className="mt-6 flex flex-wrap items-start gap-4">
          <Card className="min-w-0 flex-1 basis-[320px]">
            <Caption>
              {translate(
                'auto.components.alicorn.project.membersBound',
                'Members bound to this project'
              )}
            </Caption>
            {members === null ? (
              <p className="text-[12.5px] text-muted-foreground">
                {translate('auto.components.alicorn.project.membersLoading', 'Reading members…')}
              </p>
            ) : members.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                {translate(
                  'auto.components.alicorn.project.noMembers',
                  'The org library has no members yet. A member is a role bound to a backend, a permission mode and a workspace kind.'
                )}
              </p>
            ) : (
              members.map((member) => (
                <Row key={member.id}>
                  <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{member.role}</span>
                  <Badge>{member.backend}</Badge>
                </Row>
              ))
            )}
          </Card>

          <Card className="w-full shrink-0 sm:w-[300px]">
            <Caption>{translate('auto.components.alicorn.projects.repos', 'Repositories')}</Caption>
            {(project?.repoIds ?? []).length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                {translate(
                  'auto.components.alicorn.project.noReposOverview',
                  'No repository bound. A project owns the repositories one feature may span.'
                )}
              </p>
            ) : (
              (project?.repoIds ?? []).map((repoId) => {
                const repo = repos.find((candidate) => candidate.id === repoId)
                return (
                  <Row key={repoId}>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                      {repo?.displayName ?? repoId}
                    </span>
                    {repo ? null : (
                      <Badge>
                        {translate('auto.components.alicorn.project.repoUnresolved', 'unresolved')}
                      </Badge>
                    )}
                  </Row>
                )
              })
            )}
          </Card>
        </div>
      </AlicornScreenBody>
    </>
  )
}

function StageRow({ stage }: { stage: WorkflowStage }): React.JSX.Element {
  return (
    <>
      <span className="min-w-0 flex-1 truncate font-medium">{stage.name}</span>
      {/* A code stage runs a command with no model and no member; the kind is the label. */}
      {stage.kind === 'code' ? <Badge>{stage.kind}</Badge> : null}
      <Badge>
        {translate('auto.components.alicorn.project.checkCount', '{{count}} checks', {
          count: stage.requiredChecks.length
        })}
      </Badge>
      {stage.inheritedCost === 'high' ? (
        <Badge>{translate('auto.components.alicorn.project.inheritedCost', 'high cost')}</Badge>
      ) : null}
      {stage.reversibility === 'irreversible' ? (
        <Badge tone="attention">
          <Lock className="size-3" />
          {translate('auto.components.alicorn.project.hardStop', 'hard stop')}
        </Badge>
      ) : null}
    </>
  )
}
