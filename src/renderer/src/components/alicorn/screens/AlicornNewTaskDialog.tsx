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
 *
 * **From an issue, one at a time.** A project imported from a PM tool can pull one of its issues in
 * here: title, body and the reference back. That is the counterpart to an import that copies no
 * issues at all — you reach for the one you are about to work, and it is read live rather than from
 * a mirror that went stale the moment someone edited it upstream.
 */
import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
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
import { useProjectBoardIssues } from './use-project-board-issues'
import { useContextFileDrop } from './use-context-file-drop'
import { AlicornIssuePicker } from './AlicornIssuePicker'
import { planeIssueToTask } from '../../../../../shared/alicorn/pm-import'
import { EXECUTION_STRATEGIES } from '../../../../../shared/alicorn/ledger'
import type { ExecutionStrategy } from '../../../../../shared/alicorn/ledger'
import type { Repo } from '../../../../../shared/repo-types'
import type { ProjectSource } from '../../../../../shared/alicorn/projects'
import type { TaskInput } from '../../../../../shared/alicorn/tasks'
import type { TaskSource } from '../../../../../shared/alicorn/tasks'
import type { TaskResult } from './use-project-tasks'

/** The select's own value for "none"; an empty string is not a legal SelectItem value. */
const NO_WORKFLOW = 'none'

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
  /** The PM board this project came from, when it was imported. Null for one typed here. */
  projectSource: ProjectSource | null
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
  projectSource,
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
  // Undefined means "not chosen yet", which is different from null — null is a deliberate "no
  // workflow". Resolving it at read time keeps an effect from overwriting a choice made early.
  const [workflowId, setWorkflowId] = React.useState<string | null | undefined>(undefined)
  const [source, setSource] = React.useState<TaskSource | null>(null)
  const board = useProjectBoardIssues(projectSource, true)
  const drop = useContextFileDrop({
    root: projectRepos[0]?.path ?? null,
    onPaths: (text) =>
      setBrief((current) => (current.trim() ? `${current.trimEnd()}\n${text}` : text))
  })
  const { workflows, loading: workflowLoading } = useProjectWorkflow(projectId)
  // The project's first workflow is the default because it is the one a project is created with;
  // choosing None is how you get a raw session, and it has to be as easy to say.
  const chosenWorkflowId = workflowId === undefined ? (workflows[0]?.id ?? null) : workflowId

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
      workflowId: chosenWorkflowId,
      // The stage is the workflow's to decide, not the composer's: a task enters at the start and
      // the board moves it on. Null here means "not started", which is what a new ticket is.
      stageKey: null,
      source,
      memberIds: [...new Set(memberIds)]
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
        {projectSource ? (
          <div className="space-y-1.5">
            <FieldLabel htmlFor="alicorn-task-issue">
              {translate('auto.components.alicorn.newTask.fromIssue', 'From an issue')}
            </FieldLabel>
            {board.error ? (
              <Trail>{board.error}</Trail>
            ) : (
              <AlicornIssuePicker
                issues={board.issues.map((issue) => ({
                  id: issue.id,
                  ref: issue.readableId,
                  title: issue.name
                }))}
                loading={board.loading}
                selectedRef={source?.ref ?? null}
                boardLabel={projectSource.identifier || projectSource.boardId}
                onSelect={(option) => {
                  const issue = board.issues.find((candidate) => candidate.id === option.id)
                  if (!issue) {
                    return
                  }
                  // The same mapping the project import would have used, so a ticket pulled in here
                  // and one imported in bulk cannot describe the same issue differently.
                  const mapped = planeIssueToTask(issue)
                  setTitle(mapped.title)
                  setBrief(mapped.context)
                  setSource(mapped.source)
                }}
              />
            )}
            {source ? (
              <Trail>
                {translate(
                  'auto.components.alicorn.newTask.issueLinked',
                  'Linked to {{ref}}. The issue stays in the PM tool; this task points back at it.',
                  { ref: source.ref }
                )}
              </Trail>
            ) : null}
          </div>
        ) : null}

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
            {...drop.handlers}
            placeholder={translate(
              'auto.components.alicorn.newTask.briefPlaceholder',
              'Anything the agent cannot read off the repo: the constraint, the edge case, the decision already made. Two sentences is usually enough. Drop files in to name them.'
            )}
            className={cn(
              'min-h-[130px] w-full rounded-md border bg-background px-3 py-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
              drop.dragging ? 'border-primary border-dashed' : 'border-border'
            )}
          />
          <Trail>
            {translate(
              'auto.components.alicorn.newTask.briefTrail',
              'Captured with every run. Stage rules and required checks come from the workflow, never from here.'
            )}
          </Trail>
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="alicorn-task-workflow">
            {translate('auto.components.alicorn.newTask.workflow', 'Workflow')}
          </FieldLabel>
          {workflowLoading ? (
            <Trail>
              {translate('auto.components.alicorn.project.workflowLoading', 'Reading workflows…')}
            </Trail>
          ) : (
            <>
              <Select
                value={chosenWorkflowId ?? NO_WORKFLOW}
                onValueChange={(value) => setWorkflowId(value === NO_WORKFLOW ? null : value)}
              >
                <SelectTrigger
                  id="alicorn-task-workflow"
                  className="h-8 w-full text-xs"
                  aria-label={translate('auto.components.alicorn.newTask.workflow', 'Workflow')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((summary) => (
                    <SelectItem key={summary.id} value={summary.id} className="text-xs">
                      {summary.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_WORKFLOW} className="text-xs">
                    {translate('auto.components.alicorn.newTask.noWorkflowOption', 'No workflow')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Trail>
                {chosenWorkflowId
                  ? translate(
                      'auto.components.alicorn.newTask.workflowTrail',
                      'Its stages, its gates and its required checks. All authored on the workflow, never by whoever is working the task.'
                    )
                  : translate(
                      'auto.components.alicorn.newTask.noWorkflowTrail',
                      'A raw session on the brief — no stages, no hand-off, nothing to gate at. This is what most work wants.'
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
