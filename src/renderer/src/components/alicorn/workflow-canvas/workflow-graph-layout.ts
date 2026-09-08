import type {
  TransitionKind,
  WorkflowStage,
  WorkflowTransition
} from '../../../../../shared/alicorn/workflows'

/**
 * Geometry for the workflow canvas. Pure — no React, no DOM — so the thing that decides where a
 * correction edge goes is testable without rendering anything.
 *
 * The spine runs top to bottom in ordinal order rather than left to right. Two reasons: a workflow
 * is near-linear and up to 40 stages long, so a column scrolls where a row would need panning; and
 * it leaves both margins free for edges that do not follow the spine. **Correction edges arc down
 * the right margin** — they are the only thing that travels upward, which is what makes the return
 * path legible at a glance rather than something you read the labels to find. A forward edge that
 * skips a stage takes the left margin.
 */

export const STAGE_WIDTH = 248
export const STAGE_HEIGHT = 68
const STAGE_GAP = 36
const LANE_WIDTH = 26
const MARGIN = 14
/** Room for an edge label sitting outside the outermost lane. */
const LABEL_ROOM = 10

type Point = readonly [number, number]

export type LaidOutStage = {
  stage: WorkflowStage
  x: number
  y: number
  width: number
  height: number
}

export type LaidOutEdge = {
  /** Stable and unique — the contract rejects two edges on one (from, to) pair. */
  id: string
  transition: WorkflowTransition
  kind: TransitionKind
  /** Which margin the edge is routed through; a spine edge runs straight down the middle. */
  route: 'spine' | 'left' | 'right'
  path: string
  labelX: number
  labelY: number
  /** Where the arrowhead lands, so a marker can be drawn without re-parsing the path. */
  tip: { x: number; y: number }
}

export type WorkflowLayout = {
  width: number
  height: number
  stages: LaidOutStage[]
  edges: LaidOutEdge[]
  /** Edges with an endpoint outside the graph. Drawn nowhere, reported so none is silently lost. */
  danglingTransitions: WorkflowTransition[]
}

export function transitionId(transition: Pick<WorkflowTransition, 'from' | 'to'>): string {
  return `${transition.from}->${transition.to}`
}

/** Greedy interval colouring: two edges share a lane only when their spans do not overlap. */
function assignLanes(spans: readonly { top: number; bottom: number }[]): number[] {
  const laneBottoms: number[] = []
  return spans.map((span) => {
    const free = laneBottoms.findIndex((bottom) => bottom <= span.top)
    const lane = free === -1 ? laneBottoms.length : free
    laneBottoms[lane] = span.bottom
    return lane
  })
}

function polyline(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

type Routed = { transition: WorkflowTransition; fromIndex: number; toIndex: number }

type Partitioned = {
  spine: Routed[]
  right: Routed[]
  left: Routed[]
  dangling: WorkflowTransition[]
}

function partition(
  transitions: readonly WorkflowTransition[],
  indexByKey: ReadonlyMap<string, number>
): Partitioned {
  const out: Partitioned = { spine: [], right: [], left: [], dangling: [] }
  for (const transition of transitions) {
    const fromIndex = indexByKey.get(transition.from)
    const toIndex = indexByKey.get(transition.to)
    if (fromIndex === undefined || toIndex === undefined) {
      out.dangling.push(transition)
      continue
    }
    const routed = { transition, fromIndex, toIndex }
    // Why the authored kind and not the direction: an edge authored `correction` is drawn as a
    // return even when a reorder has left it pointing the wrong way, so the mistake is on screen.
    if (transition.kind === 'correction' || toIndex < fromIndex) {
      out.right.push(routed)
    } else if (toIndex === fromIndex + 1) {
      out.spine.push(routed)
    } else {
      out.left.push(routed)
    }
  }
  return out
}

function marginLanes(
  routed: readonly Routed[],
  centreY: (index: number) => number
): { lane: number[]; count: number } {
  const lane = assignLanes(
    routed.map(({ fromIndex, toIndex }) => ({
      top: Math.min(centreY(fromIndex), centreY(toIndex)),
      bottom: Math.max(centreY(fromIndex), centreY(toIndex))
    }))
  )
  return { lane, count: lane.length === 0 ? 0 : Math.max(...lane) + 1 }
}

function marginEdge(
  item: Routed,
  lane: number,
  side: 'left' | 'right',
  spineX: number,
  centreY: (index: number) => number
): LaidOutEdge {
  const attachX = side === 'right' ? spineX + STAGE_WIDTH : spineX
  const laneX = attachX + (side === 'right' ? 1 : -1) * (lane + 1) * LANE_WIDTH
  const startY = centreY(item.fromIndex)
  const endY = centreY(item.toIndex)
  return {
    id: transitionId(item.transition),
    transition: item.transition,
    kind: item.transition.kind,
    route: side,
    path: polyline([
      [attachX, startY],
      [laneX, startY],
      [laneX, endY],
      [attachX, endY]
    ]),
    labelX: laneX,
    labelY: (startY + endY) / 2,
    tip: { x: attachX, y: endY }
  }
}

export function layoutWorkflowGraph(graph: {
  stages: readonly WorkflowStage[]
  transitions: readonly WorkflowTransition[]
}): WorkflowLayout {
  const ordered = [...graph.stages].sort((a, b) => a.ordinal - b.ordinal)
  const indexByKey = new Map(ordered.map((stage, i) => [stage.key, i]))
  const { spine, right, left, dangling } = partition(graph.transitions, indexByKey)

  const rowTop = (index: number): number => MARGIN + index * (STAGE_HEIGHT + STAGE_GAP)
  const centreY = (index: number): number => rowTop(index) + STAGE_HEIGHT / 2

  const leftLanes = marginLanes(left, centreY)
  const rightLanes = marginLanes(right, centreY)
  const spineX = MARGIN + (leftLanes.count === 0 ? 0 : leftLanes.count * LANE_WIDTH + LABEL_ROOM)
  const centreX = spineX + STAGE_WIDTH / 2

  const spineEdges: LaidOutEdge[] = spine.map((item) => {
    const startY = rowTop(item.fromIndex) + STAGE_HEIGHT
    const endY = rowTop(item.toIndex)
    return {
      id: transitionId(item.transition),
      transition: item.transition,
      kind: item.transition.kind,
      route: 'spine',
      path: polyline([
        [centreX, startY],
        [centreX, endY]
      ]),
      labelX: centreX + 10,
      labelY: (startY + endY) / 2,
      tip: { x: centreX, y: endY }
    }
  })

  return {
    width:
      spineX +
      STAGE_WIDTH +
      (rightLanes.count === 0 ? 0 : rightLanes.count * LANE_WIDTH + LABEL_ROOM) +
      MARGIN,
    height: ordered.length === 0 ? MARGIN * 2 : rowTop(ordered.length - 1) + STAGE_HEIGHT + MARGIN,
    stages: ordered.map((stage, i) => ({
      stage,
      x: spineX,
      y: rowTop(i),
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT
    })),
    edges: [
      ...spineEdges,
      ...left.map((item, i) => marginEdge(item, leftLanes.lane[i]!, 'left', spineX, centreY)),
      ...right.map((item, i) => marginEdge(item, rightLanes.lane[i]!, 'right', spineX, centreY))
    ],
    danglingTransitions: dangling
  }
}
