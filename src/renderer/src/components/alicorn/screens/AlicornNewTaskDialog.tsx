/**
 * Creating a task: a title and enough context. Everything else is decided and shown, not asked.
 *
 * A task is not a workspace. This writes a ticket to the control plane and nothing else — no
 * branch, no worktree, no agent. Opening it is what binds the repositories it needs, which is why
 * a task can exist before anyone has started it and can later span several.
 *
 * Advanced holds only what a task actually stores. The prototype also draws a spend ceiling, a
 * per-repo branch picker and a "start now" switch; none of those have anywhere to be written yet
 * — no task field, and no renderer bridge to `alicorn_task_worktrees` — so they are absent rather
 * than drawn dead. The plan itself is `planTaskComposition`, unchanged.
 */
import React from 'react'
import { Bot, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useComposerTaskPlan } from '@/hooks/use-composer-task-plan'
import { describePlanReason, isBlockingPlanReason } from '@/lib/composer-task-plan-copy'
import { EXECUTION_STRATEGIES } from '../../../../../shared/alicorn/ledger'
import type { ExecutionStrategy } from '../../../../../shared/alicorn/ledger'
import type { Repo } from '../../../../../shared/repo-types'
import type { TaskInput } from '../../../../../shared/alicorn/tasks'
import type { TaskResult } from './use-project-tasks'

function FieldLabel({
  children,
  htmlFor
}: {
  children: React.ReactNode
  htmlFor?: string
}): React.JSX.Element {
  return (
    <label className="text-xs font-medium" htmlFor={htmlFor}>
      {children}
    </label>
  )
}

function Trail({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-[11px] text-muted-foreground">{children}</p>
}

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectName: string
  projectRepos: readonly Repo[]
  onCreate: (input: Omit<TaskInput, 'projectId'>) => Promise<TaskResult>
  onCreated: (taskId: string) => void
}

/**
 * The body mounts only while the dialog is open, so a second New task starts empty without an
 * effect resetting fields after the fact — which is a frame of the last draft on screen.
 */
export function AlicornNewTaskDialog(props: DialogProps): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <NewTaskDialogBody {...props} /> : null}
    </Dialog>
  )
}

function NewTaskDialogBody({
  onOpenChange,
  projectName,
  projectRepos,
  onCreate,
  onCreated
}: DialogProps): React.JSX.Element {
  const [title, setTitle] = React.useState('')
  const [brief, setBrief] = React.useState('')
  const [strategy, setStrategy] = React.useState<ExecutionStrategy>('single')
  const [advanced, setAdvanced] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  const repoOptions = React.useMemo(
    () => projectRepos.map((repo) => ({ id: repo.id, name: repo.displayName })),
    [projectRepos]
  )
  const plan = useComposerTaskPlan({
    title,
    brief,
    repos: repoOptions,
    openRepoId: repoOptions[0]?.id ?? null
  })
  const names = React.useMemo(
    () => ({
      memberName: plan.memberName,
      repoName: (id: string): string => repoOptions.find((repo) => repo.id === id)?.name ?? id
    }),
    [plan.memberName, repoOptions]
  )

  const author = plan.members.find((member) => member.id === plan.authorId) ?? null
  const clash = plan.plan?.reviewerConflict ?? false
  const canSubmit = title.trim().length > 0 && !busy

  const submit = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const memberIds = [plan.authorId, plan.reviewerId].filter((id): id is string => id !== null)
    const result = await onCreate({
      title: title.trim(),
      context: brief,
      column: 'todo',
      executionStrategy: strategy,
      stageKey: null,
      memberIds: [...new Set(memberIds)],
      source: null
    })
    setBusy(false)
    if (!result.ok) {
      setFailure(result.error)
      return
    }
    onOpenChange(false)
    onCreated(result.task.id)
  }

  return (
    <DialogContent className="scrollbar-sleek max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {translate('auto.components.alicorn.newTask.titleIn', 'New task in {{project}}', {
            project: projectName
          })}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'auto.components.alicorn.newTask.description',
            'A title and enough context. Everything else is decided for you and shown below.'
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="alicorn-task-title">
            {translate('auto.components.alicorn.newTask.whatNeedsDoing', 'What needs doing')}
          </FieldLabel>
          <Input
            id="alicorn-task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={translate(
              'auto.components.alicorn.newTask.titlePlaceholder',
              'Refund API — partial refunds'
            )}
            className="h-10 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="alicorn-task-brief">
            {translate('auto.components.alicorn.newTask.context', 'Context')}
          </FieldLabel>
          <textarea
            id="alicorn-task-brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder={translate(
              'auto.components.alicorn.newTask.briefPlaceholder',
              'Anything the agent cannot read off the repo: the constraint, the edge case, the decision already made. Two sentences is usually enough.'
            )}
            className="min-h-[130px] w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <Trail>
            {translate(
              'auto.components.alicorn.newTask.briefTrail',
              'Captured with every run. Everything else — workflow, stage rules, required checks — comes from the project.'
            )}
          </Trail>
        </div>

        {plan.available ? (
          <div
            className={cn(
              'flex gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px]',
              clash ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-muted/40'
            )}
          >
            {clash ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : (
              <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <span className="font-semibold">
                {translate('auto.components.alicorn.newTask.planTitle', 'Claude’s plan')}
              </span>{' '}
              {author ? (
                <span>
                  {translate(
                    'auto.components.alicorn.newTask.planLine',
                    '— {{author}} starts on {{backend}}.',
                    { author: author.name, backend: author.backend }
                  )}
                </span>
              ) : (
                <span>
                  {translate(
                    'auto.components.alicorn.newTask.planNoMember',
                    '— no member joins yet, so the task will gate at its first stage.'
                  )}
                </span>
              )}
              {plan.plan && plan.plan.reasons.length > 0 && !plan.pinned ? (
                <div className="mt-1 text-muted-foreground">
                  {plan.plan.reasons
                    .filter((reason) => !isBlockingPlanReason(reason))
                    .map((reason) => describePlanReason(reason, names))
                    .join(' · ')}
                </div>
              ) : null}
              {plan.pinned ? (
                <div className="mt-1 text-muted-foreground">
                  {translate(
                    'auto.components.alicorn.newTask.pinned',
                    'You changed the plan — Claude has stopped adjusting it.'
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setAdvanced((current) => !current)}
          className="flex items-center gap-1 text-[12.5px] text-muted-foreground transition hover:text-foreground"
        >
          {advanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {advanced
            ? translate('auto.components.alicorn.newTask.hideAdvanced', 'Hide members and strategy')
            : translate(
                'auto.components.alicorn.newTask.showAdvanced',
                'Change members and strategy'
              )}
        </button>

        {advanced ? (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="space-y-1.5">
              <FieldLabel>
                {translate(
                  'auto.components.alicorn.project.executionStrategy',
                  'Execution strategy'
                )}
              </FieldLabel>
              <div className="flex gap-1 rounded-md border border-border p-1">
                {EXECUTION_STRATEGIES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStrategy(value)}
                    className={cn(
                      'flex-1 rounded px-2 py-1 text-[12px] transition',
                      strategy === value
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <Trail>
                {strategy === 'orchestrated'
                  ? translate(
                      'auto.components.alicorn.newTask.orchestratedTrail',
                      'Roughly 10–15× the tokens. A trade, not an upgrade.'
                    )
                  : translate(
                      'auto.components.alicorn.newTask.singleTrail',
                      'One agent in one session — the default, and what most work wants.'
                    )}
              </Trail>
            </div>

            {plan.available ? (
              <div className="space-y-2">
                <FieldLabel>
                  {translate('auto.components.alicorn.newTask.members', 'Members')}
                </FieldLabel>
                <MemberRow
                  label={translate('auto.components.alicorn.newTask.author', 'Builds')}
                  value={plan.authorId}
                  members={plan.members}
                  onChange={plan.setAuthorId}
                />
                <MemberRow
                  label={translate('auto.components.alicorn.newTask.reviewer', 'Reviews')}
                  value={plan.reviewerId}
                  members={plan.members}
                  onChange={plan.setReviewerId}
                />
                {clash ? (
                  <Trail>
                    {translate(
                      'auto.components.alicorn.newTask.clash',
                      'Reviewer and author share a backend, so this would gate at review. Change one.'
                    )}
                  </Trail>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {failure ? <p className="text-[11px] text-destructive">{failure}</p> : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          {translate('auto.components.alicorn.newProject.cancel', 'Cancel')}
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>
          {translate('auto.components.alicorn.newTask.createInBacklog', 'Create in Backlog')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function MemberRow({
  label,
  value,
  members,
  onChange
}: {
  label: string
  value: string | null
  members: { id: string; name: string; backend: string }[]
  onChange: (id: string) => void
}): React.JSX.Element | null {
  if (members.length === 0) {
    return null
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-full min-w-0 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {members.map((member) => (
            <SelectItem key={member.id} value={member.id} className="text-xs">
              {member.name} · {member.backend}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
