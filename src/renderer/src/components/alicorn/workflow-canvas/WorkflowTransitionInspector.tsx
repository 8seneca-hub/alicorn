import { useState } from 'react'
import {
  TRANSITION_KINDS,
  type TriggerKind,
  type WorkflowStage,
  type WorkflowTransition
} from '../../../../../shared/alicorn/workflows'
import { issueLabel, transitionKindLabel, triggerLabel } from './workflow-canvas-labels'
import { issuesForTransition, type DraftIssue } from './workflow-draft-validation'
import { Button } from '../../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

const TRIGGER_KINDS: readonly TriggerKind[] = ['on_success', 'on_failure', 'manual']

/**
 * The edge list, and where a **correction edge** is authored.
 *
 * A return is a real edge a human draws — pick where it goes back to and say it is a correction —
 * not something the engine falls back to when a check fails. The kind is a plain choice next to
 * the trigger, because an `on_failure` edge to a triage stage is a legitimate forward edge and
 * deriving one from the other would draw a graph nobody authored.
 */
export function WorkflowTransitionInspector({
  stages,
  transitions,
  issues,
  selected,
  onSelect,
  onUpsert,
  onRemove
}: {
  stages: readonly WorkflowStage[]
  transitions: readonly WorkflowTransition[]
  issues: readonly DraftIssue[]
  selected: WorkflowTransition | null
  onSelect: (transition: WorkflowTransition) => void
  onUpsert: (transition: WorkflowTransition) => void
  onRemove: (from: string, to: string) => void
}): React.JSX.Element {
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')

  const ordinalOf = (key: string): number => stages.find((stage) => stage.key === key)?.ordinal ?? 0
  const canAdd = from !== '' && to !== '' && from !== to

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {transitions.map((transition) => {
          const broken = issuesForTransition(issues, transition.from, transition.to)
          const active = selected?.from === transition.from && selected?.to === transition.to
          return (
            <li key={`${transition.from}->${transition.to}`}>
              <button
                type="button"
                onClick={() => onSelect(transition)}
                aria-pressed={active}
                className={cn(
                  'hover:bg-accent flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs',
                  active ? 'border-ring' : 'border-transparent',
                  broken.length > 0 && 'border-destructive'
                )}
              >
                <span className="font-mono">
                  {transition.from} → {transition.to}
                </span>
                <span
                  className={cn(
                    transition.kind === 'correction'
                      ? 'text-status-attention font-medium'
                      : 'text-muted-foreground'
                  )}
                >
                  {transitionKindLabel(transition.kind)}
                </span>
                <span className="text-muted-foreground">
                  {triggerLabel(transition.trigger.kind)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {selected ? (
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <EdgeSelect
              label={translate('auto.components.alicorn.workflowCanvas.edgeKind', 'Edge')}
              value={selected.kind}
              options={TRANSITION_KINDS}
              describe={transitionKindLabel}
              onChange={(kind) => onUpsert({ ...selected, kind })}
            />
            <EdgeSelect
              label={translate('auto.components.alicorn.workflowCanvas.trigger', 'Fires')}
              value={selected.trigger.kind}
              options={TRIGGER_KINDS}
              describe={triggerLabel}
              onChange={(kind) => onUpsert({ ...selected, trigger: { kind } })}
            />
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onRemove(selected.from, selected.to)}
            >
              {translate('auto.components.alicorn.workflowCanvas.removeEdge', 'Remove edge')}
            </Button>
          </div>
          {issuesForTransition(issues, selected.from, selected.to).map((issue) => (
            <p key={issue.code} className="text-destructive text-xs">
              {issueLabel(issue.code)}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <StageSelect
          label={translate('auto.components.alicorn.workflowCanvas.edgeFrom', 'From')}
          value={from}
          stages={stages}
          onChange={setFrom}
        />
        <StageSelect
          label={translate('auto.components.alicorn.workflowCanvas.edgeTo', 'To')}
          value={to}
          stages={stages}
          onChange={setTo}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!canAdd}
          onClick={() => {
            const returns = ordinalOf(to) < ordinalOf(from)
            onUpsert({
              from,
              to,
              // Only the *starting* kind: whichever way the edge runs, the human can change it.
              kind: returns ? 'correction' : 'forward',
              trigger: { kind: returns ? 'on_failure' : 'on_success' }
            })
            setFrom('')
            setTo('')
          }}
        >
          {translate('auto.components.alicorn.workflowCanvas.addEdge', 'Add edge')}
        </Button>
      </div>
    </div>
  )
}

function StageSelect({
  label,
  value,
  stages,
  onChange
}: {
  label: string
  value: string
  stages: readonly WorkflowStage[]
  onChange: (next: string) => void
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-40 text-xs" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {stages.map((stage) => (
          <SelectItem key={stage.key} value={stage.key} className="text-xs">
            {stage.name || stage.key}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function EdgeSelect<T extends string>({
  label,
  value,
  options,
  describe,
  onChange
}: {
  label: string
  value: T
  options: readonly T[]
  describe: (value: T) => string
  onChange: (next: T) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger className="h-7 w-36 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option} className="text-xs">
              {describe(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
