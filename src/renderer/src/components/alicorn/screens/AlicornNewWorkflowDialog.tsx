/**
 * Creating a workflow for a project: a name, and the shape it starts as.
 *
 * Templates are the real starting points — a template stage names a *role*, and instantiation is
 * what binds it to a member, which is work the Control API does and this dialog must not repeat.
 * "One stage" exists because the graph schema requires at least one: there is no such thing as an
 * empty workflow, so the honest blank start is a single stage to build out on the canvas.
 */
import React from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { Workflow, WorkflowTemplate } from '../../../../../shared/alicorn/workflows'

/** The one stage a blank workflow starts with — the schema refuses a graph with none. */
const FIRST_STAGE = {
  key: 'spec',
  name: 'Spec',
  ordinal: 0,
  memberId: null,
  columnId: 'todo',
  kind: 'worker' as const,
  codeCommand: null,
  reversibility: 'free' as const,
  inheritedCost: 'low' as const,
  requiredChecks: []
}

const BLANK = 'blank'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
  onCreated: (workflow: Workflow) => void
}

export function AlicornNewWorkflowDialog(props: Props): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <NewWorkflowDialogBody {...props} /> : null}
    </Dialog>
  )
}

function NewWorkflowDialogBody({
  onOpenChange,
  projectId,
  projectName,
  onCreated
}: Props): React.JSX.Element {
  const [templates, setTemplates] = React.useState<WorkflowTemplate[] | null>(null)
  const [choice, setChoice] = React.useState<string>(BLANK)
  // Empty means "whatever the choice is called"; a typed name overrides it.
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api?.alicorn?.listWorkflowTemplates?.()
      if (cancelled || !result) {
        return
      }
      if (!result.ok) {
        setFailure(result.error)
        setTemplates([])
        return
      }
      setTemplates(result.templates)
      const first = result.templates[0]
      if (first) {
        setChoice(first.key)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedTemplate = (templates ?? []).find((template) => template.key === choice) ?? null
  const defaultName =
    selectedTemplate?.name ??
    translate('auto.components.alicorn.newWorkflow.blankName', 'New workflow')
  const effectiveName = name.trim() || defaultName

  const submit = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const result =
      choice === BLANK
        ? await window.api.alicorn.createWorkflow({
            projectId,
            name: effectiveName,
            stages: [FIRST_STAGE],
            transitions: []
          })
        : await window.api.alicorn.createWorkflowFromTemplate({
            projectId,
            templateKey: choice,
            name: effectiveName
          })
    setBusy(false)
    if (!result.ok) {
      setFailure(result.error)
      return
    }
    onOpenChange(false)
    onCreated(result.workflow)
  }

  return (
    <DialogContent className="scrollbar-sleek max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {translate('auto.components.alicorn.newWorkflow.titleIn', 'New workflow in {{project}}', {
            project: projectName
          })}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'auto.components.alicorn.newWorkflow.description',
            'A workflow is optional. Attaching one gives a task stages to hand off at, and gates to stop at.'
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="alicorn-workflow-name">
            {translate('auto.components.alicorn.newWorkflow.name', 'Name')}
          </label>
          <Input
            id="alicorn-workflow-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={defaultName}
            className="h-10 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium">
            {translate('auto.components.alicorn.newWorkflow.startsAs', 'Starts as')}
          </span>
          {templates === null ? (
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {translate('auto.components.alicorn.newWorkflow.loading', 'Reading templates…')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {(templates ?? []).map((template) => (
                <Choice
                  key={template.key}
                  active={choice === template.key}
                  title={template.name}
                  detail={template.description}
                  meta={translate(
                    'auto.components.alicorn.newWorkflow.stageCount',
                    '{{count}} stages',
                    { count: template.stages.length }
                  )}
                  onSelect={() => setChoice(template.key)}
                />
              ))}
              <Choice
                active={choice === BLANK}
                title={translate('auto.components.alicorn.newWorkflow.blank', 'One stage')}
                detail={translate(
                  'auto.components.alicorn.newWorkflow.blankDetail',
                  'A single Spec stage to build out on the canvas. There is no empty workflow — a graph needs at least one stage.'
                )}
                onSelect={() => setChoice(BLANK)}
              />
            </div>
          )}
        </div>

        {failure ? <p className="text-[11px] text-destructive">{failure}</p> : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          {translate('auto.components.alicorn.newProject.cancel', 'Cancel')}
        </Button>
        <Button size="sm" disabled={busy || templates === null} onClick={() => void submit()}>
          {translate('auto.components.alicorn.newWorkflow.create', 'Create workflow')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function Choice({
  active,
  title,
  detail,
  meta,
  onSelect
}: {
  active: boolean
  title: string
  detail: string
  meta?: string
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'w-full rounded-lg border px-3 py-2.5 text-left transition',
        active ? 'border-primary bg-accent' : 'border-border hover:bg-accent'
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
        {meta ? <span className="shrink-0 text-[11px] text-muted-foreground">{meta}</span> : null}
      </span>
      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
        {detail}
      </span>
    </button>
  )
}
