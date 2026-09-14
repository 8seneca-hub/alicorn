/**
 * The project's workflows, as the thing you pick from before you read one.
 *
 * This was a row of pills that appeared only once a project had two workflows, so the common case —
 * one workflow — looked like a screen with no choice on it at all, and "New workflow" read as the
 * only thing you could do. A project holds a set; showing the set is what makes a second one
 * obviously possible.
 *
 * A card is deliberately thin: name, how many stages, which version. Everything else about a
 * workflow is a property of its stages, and those are below.
 */
import React from 'react'
import { Plus, Workflow as WorkflowIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { WorkflowSummary } from '../../../../../shared/alicorn/workflows'

export function AlicornWorkflowCards({
  workflows,
  selectedId,
  onSelect,
  onNew
}: {
  workflows: readonly WorkflowSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}): React.JSX.Element {
  return (
    <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
      {workflows.map((summary) => {
        const selected = summary.id === selectedId
        return (
          <button
            key={summary.id}
            type="button"
            onClick={() => onSelect(summary.id)}
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border px-3.5 py-3 text-left transition',
              selected
                ? 'border-foreground bg-accent'
                : 'border-border hover:bg-accent hover:border-border'
            )}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              <WorkflowIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {summary.name}
              </span>
            </span>
            <span className="text-[11px] text-muted-foreground">
              {translate(
                'auto.components.alicorn.workflowCard.meta',
                '{{count}} stages · v{{version}}',
                { count: summary.stageCount, version: summary.version }
              )}
            </span>
          </button>
        )
      })}
      <button
        type="button"
        onClick={onNew}
        className="flex flex-col items-start justify-center gap-1 rounded-xl border border-dashed border-border px-3.5 py-3 text-left text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <Plus className="size-3.5" />
          {translate('auto.components.alicorn.project.newWorkflow', 'New workflow')}
        </span>
        <span className="text-[11px]">
          {translate(
            'auto.components.alicorn.workflowCard.newDetail',
            'Start from an org template, or empty.'
          )}
        </span>
      </button>
    </div>
  )
}
