/**
 * The `(i)` beside a term that carries a rule you cannot read off the word.
 *
 * Alicorn's screens name several things — a workflow, an execution strategy, an autonomy level —
 * whose behaviour is a decision taken elsewhere and enforced somewhere else again. One component
 * rather than a tooltip spelled per site, because a rule restated in six shapes is six things to
 * keep true.
 */
import React from 'react'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function AlicornInfoHint({
  label,
  children
}: {
  /** What the icon is, for a screen reader — the tooltip body is not announced. */
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          // Sitting beside a <label>, a plain click would move focus to the field the label points
          // at and close the tooltip with the gesture that opened it.
          onPointerDown={(event) => event.preventDefault()}
          className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="max-w-[320px] space-y-1.5 text-left leading-relaxed"
        style={{ zIndex: 120 }}
      >
        {children}
      </TooltipContent>
    </Tooltip>
  )
}
