import { useMemo } from 'react'
import type { Member } from '../../../../../shared/alicorn/members'
import type { WorkflowStage, WorkflowTransition } from '../../../../../shared/alicorn/workflows'
import { layoutWorkflowGraph, transitionId, type LaidOutEdge } from './workflow-graph-layout'
import { WorkflowStageNode } from './WorkflowStageNode'
import { transitionKindLabel, triggerLabel } from './workflow-canvas-labels'
import { issuesForStage, issuesForTransition, type DraftIssue } from './workflow-draft-validation'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export type CanvasSelection =
  | { kind: 'stage'; key: string }
  | { kind: 'transition'; from: string; to: string }
  | null

/**
 * The workflow as a picture: a vertical spine of stages, with the **correction edge** arcing back
 * up the right margin.
 *
 * Hand-rolled SVG on purpose — GRAPH-ENGINEERING's "what we do not adopt" rules out a graph
 * library, because a workflow is near-linear and a layout engine would cost more than it draws.
 * Nodes are real buttons in the DOM over the SVG, so the canvas is keyboard-reachable; edges are
 * painted (`aria-hidden`) and reached through the edge list the inspector renders.
 */
export function WorkflowCanvas({
  stages,
  transitions,
  members,
  issues,
  selection,
  onSelect
}: {
  stages: readonly WorkflowStage[]
  transitions: readonly WorkflowTransition[]
  members: readonly Member[]
  issues: readonly DraftIssue[]
  selection: CanvasSelection
  onSelect: (selection: CanvasSelection) => void
}): React.JSX.Element {
  const layout = useMemo(() => layoutWorkflowGraph({ stages, transitions }), [stages, transitions])
  const memberName = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members]
  )

  return (
    <div className="bg-muted/30 scrollbar-sleek overflow-auto rounded-md border p-2">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg
          aria-hidden
          width={layout.width}
          height={layout.height}
          className="absolute inset-0"
          style={{ pointerEvents: 'none' }}
        >
          <defs>
            <Arrowhead id="workflow-arrow-forward" className="fill-muted-foreground" />
            <Arrowhead id="workflow-arrow-correction" className="fill-status-attention" />
            <Arrowhead id="workflow-arrow-invalid" className="fill-destructive" />
          </defs>
          {layout.edges.map((edge) => (
            <EdgePath
              key={edge.id}
              edge={edge}
              invalid={
                issuesForTransition(issues, edge.transition.from, edge.transition.to).length > 0
              }
              selected={
                selection?.kind === 'transition' &&
                selection.from === edge.transition.from &&
                selection.to === edge.transition.to
              }
              onSelect={() =>
                onSelect({
                  kind: 'transition',
                  from: edge.transition.from,
                  to: edge.transition.to
                })
              }
            />
          ))}
        </svg>

        {layout.stages.map((laidOut) => (
          <WorkflowStageNode
            key={laidOut.stage.key}
            laidOut={laidOut}
            memberName={
              laidOut.stage.memberId ? (memberName.get(laidOut.stage.memberId) ?? null) : null
            }
            selected={selection?.kind === 'stage' && selection.key === laidOut.stage.key}
            invalid={issuesForStage(issues, laidOut.stage.key).length > 0}
            onSelect={() => onSelect({ kind: 'stage', key: laidOut.stage.key })}
          />
        ))}

        {stages.length === 0 ? (
          <p className="text-muted-foreground p-4 text-xs">
            {translate(
              'auto.components.alicorn.workflowCanvas.empty',
              'No stages yet. Add one, or start from a template.'
            )}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Arrowhead({ id, className }: { id: string; className: string }): React.JSX.Element {
  return (
    <marker
      id={id}
      viewBox="0 0 8 8"
      refX="7"
      refY="4"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
    >
      <path d="M 0 1 L 7 4 L 0 7 z" className={className} />
    </marker>
  )
}

function EdgePath({
  edge,
  invalid,
  selected,
  onSelect
}: {
  edge: LaidOutEdge
  invalid: boolean
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const correction = edge.kind === 'correction'
  const marker = invalid
    ? 'workflow-arrow-invalid'
    : correction
      ? 'workflow-arrow-correction'
      : 'workflow-arrow-forward'
  return (
    <g data-testid={`workflow-edge-${transitionId(edge.transition)}`} data-edge-kind={edge.kind}>
      {/* A fat transparent copy of the path, so a 1px line is still clickable. */}
      <path
        d={edge.path}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onClick={onSelect}
      />
      <path
        d={edge.path}
        fill="none"
        markerEnd={`url(#${marker})`}
        // Dashed as well as coloured: the return path has to read as different without colour.
        strokeDasharray={correction ? '4 3' : undefined}
        strokeWidth={selected ? 2 : 1.5}
        className={cn(
          invalid
            ? 'stroke-destructive'
            : correction
              ? 'stroke-status-attention'
              : 'stroke-muted-foreground'
        )}
      />
      {correction ? (
        <text
          x={edge.labelX}
          y={edge.labelY}
          textAnchor={edge.route === 'left' ? 'end' : 'start'}
          dx={edge.route === 'left' ? -6 : 6}
          className="fill-status-attention text-[10px]"
        >
          {transitionKindLabel(edge.kind)}
        </text>
      ) : (
        <title>{triggerLabel(edge.transition.trigger.kind)}</title>
      )}
    </g>
  )
}
