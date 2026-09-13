/**
 * Creating a task: a title, enough context, and where in the workflow it starts.
 *
 * A task is not a workspace. This writes a ticket to the control plane and nothing else — no
 * branch, no worktree, no agent. Opening it is what binds the repositories it needs, which is why
 * a task can exist before anyone has started it and can later span several.
 *
 * **Members are not asked for.** `planTaskComposition` still picks the author and the reviewer and
 * they are still written to the task — the composer just does not put the choice in front of you,
 * because who builds a ticket is Claude's to decide from the brief and the org policy, and a
 * picker here only invites a worse answer than the one the plan already has.
 *
 * Everything drawn writes a real field. The prototype also draws a spend ceiling, a per-repo
 * branch picker and a "start now" switch; none of those have anywhere to be written yet — no task
 * field, and no renderer bridge to `alicorn_task_worktrees` — so they are absent rather than drawn
 * dead.
 */
import React from 'react'
import { ChevronDown, ChevronRight, Workflow } from 'lucide-react'
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
import { useProjectWorkflow } from './use-project-workflow'
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
  projectId: string
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
  projectId,
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
  // Null while the workflow is still being read, so the first stage can be the default without an
  // effect that would overwrite a choice made before the read settled.
  const [stageKey, setStageKey] = React.useState<string | null>(null)
  const { workflow, loading: workflowLoading } = useProjectWorkflow(projectId)
  const stages = workflow?.stages ?? []
  const startStage = stageKey ?? stages[0]?.key ?? null

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
      stageKey: startStage,
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
            'A title and enough context. Who works on it is Claude’s to decide from the brief.'
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
              'Captured with every run. Stage rules and required checks come from the workflow, never from here.'
            )}
          </Trail>
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="alicorn-task-stage">
            {translate('auto.components.alicorn.newTask.workflow', 'Workflow')}
          </FieldLabel>
          {workflowLoading ? (
            <Trail>
              {translate('auto.components.alicorn.project.workflowLoading', 'Reading workflows…')}
            </Trail>
          ) : stages.length === 0 ? (
            <Trail>
              {translate(
                'auto.components.alicorn.newTask.noWorkflow',
                'This project has no workflow, so the task starts at no stage. That is still a perfectly ordinary task — it just has nowhere to hand off at.'
              )}
            </Trail>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                <Workflow className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {workflow?.name}
                </span>
                <Select value={startStage ?? ''} onValueChange={setStageKey}>
                  <SelectTrigger
                    id="alicorn-task-stage"
                    className="h-7 w-[190px] shrink-0 text-xs"
                    aria-label={translate('auto.components.alicorn.newTask.startsAt', 'Starts at')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => (
                      <SelectItem key={stage.key} value={stage.key} className="text-xs">
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Trail>
                {translate(
                  'auto.components.alicorn.newTask.workflowTrail',
                  'The stage it starts at. Required checks, reversibility and inherited cost come from the stage, never from whoever is working it.'
                )}
              </Trail>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAdvanced((current) => !current)}
          className="flex items-center gap-1 text-[12.5px] text-muted-foreground transition hover:text-foreground"
        >
          {advanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {advanced
            ? translate(
                'auto.components.alicorn.newTask.hideAdvanced',
                'Hide the execution strategy'
              )
            : translate(
                'auto.components.alicorn.newTask.showAdvanced',
                'Change the execution strategy'
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
