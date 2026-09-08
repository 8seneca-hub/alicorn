import type { LaidOutStage } from './workflow-graph-layout'
import { inheritedCostLabel, reversibilityLabel, stageKindLabel } from './workflow-canvas-labels'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

/**
 * One stage on the canvas.
 *
 * An irreversible stage is drawn apart from the others — a destructive border and a badge that
 * says so in words, not colour alone. `reversibility` and `inherited_cost` are authored here and
 * nowhere else (ARCHITECTURE §7), and guessing one of them wrong is a production deploy, so the
 * authored value is on the box rather than a click away in the inspector.
 */
export function WorkflowStageNode({
  laidOut,
  memberName,
  selected,
  invalid,
  onSelect
}: {
  laidOut: LaidOutStage
  /** Null when the stage names no member, or when the roster could not be read. */
  memberName: string | null
  selected: boolean
  invalid: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { stage, x, y, width, height } = laidOut
  const irreversible = stage.reversibility === 'irreversible'
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ left: x, top: y, width, height }}
      aria-pressed={selected}
      className={cn(
        'absolute flex flex-col justify-center gap-0.5 rounded-md border bg-card px-3 py-2 text-left',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        irreversible ? 'border-destructive' : 'border-border',
        selected && 'ring-ring ring-2',
        invalid && 'border-destructive border-dashed'
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="truncate text-xs font-medium">{stage.name || stage.key}</span>
        <span className="text-muted-foreground truncate font-mono text-[10px]">{stage.key}</span>
      </span>
      <span className="text-muted-foreground flex items-center gap-1.5 truncate text-[10px]">
        <span className={cn(irreversible && 'text-destructive font-medium')}>
          {reversibilityLabel(stage.reversibility)}
        </span>
        <span aria-hidden>·</span>
        <span className={cn(stage.inheritedCost === 'high' && 'text-status-attention font-medium')}>
          {inheritedCostLabel(stage.inheritedCost)}
        </span>
        <span aria-hidden>·</span>
        <span>{stageKindLabel(stage.kind)}</span>
      </span>
      <span className="text-muted-foreground truncate text-[10px]">
        {stage.kind === 'code'
          ? (stage.codeCommand ??
            translate('auto.components.alicorn.workflowCanvas.noCommand', 'No command yet'))
          : (memberName ??
            translate('auto.components.alicorn.workflowCanvas.noMember', 'No member assigned'))}
      </span>
    </button>
  )
}
