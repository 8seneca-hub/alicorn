import type { TransitionKind, Workflow, WorkflowStage } from '../../../shared/alicorn/workflows'

/**
 * Where a finished code stage hands the workspace next.
 *
 * `none` is a stage that finished with nowhere to go — the end of the chain. `gate` is a failure
 * the graph does not handle, which is the case that must reach a human: a deterministic step failed
 * and no correction edge says what to do about it, so nothing may quietly carry on.
 */
export type CodeStageRoute =
  | { kind: 'move'; toStatusId: string; edge: TransitionKind }
  | { kind: 'gate'; reason: 'unverified'; detail: string }
  | { kind: 'none' }

type WorkflowGraph = Pick<Workflow, 'stages' | 'transitions'>

type Hop = { stage: WorkflowStage | null; edge: TransitionKind }

function follow(workflow: WorkflowGraph, from: string, trigger: string): Hop | null {
  // The contract rejects two edges of one trigger out of one stage, so the first is the only one.
  const edge = workflow.transitions.find(
    (candidate) => candidate.from === from && candidate.trigger.kind === trigger
  )
  if (!edge) {
    return null
  }
  // Why the authored kind and not the trigger: an `on_failure` edge may legitimately go forward to
  // a triage stage, and reporting that as a correction would misname what happened (WF2).
  return { stage: workflow.stages.find((stage) => stage.key === edge.to) ?? null, edge: edge.kind }
}

export function routeCodeStage(
  workflow: WorkflowGraph,
  stageKey: string,
  outcome: 'succeeded' | 'failed'
): CodeStageRoute {
  if (outcome === 'succeeded') {
    const next = follow(workflow, stageKey, 'on_success')
    // A terminal stage, or one handing to a stage no board column shows, has nowhere to move to.
    // That is the end of the chain rather than something to interrupt anyone over.
    return next?.stage?.columnId
      ? { kind: 'move', toStatusId: next.stage.columnId, edge: next.edge }
      : { kind: 'none' }
  }
  // The correction edge — a deterministic step failed, and the graph says where that goes back to.
  const handled = follow(workflow, stageKey, 'on_failure')
  const correction = handled?.stage ?? null
  if (correction?.columnId) {
    return { kind: 'move', toStatusId: correction.columnId, edge: handled?.edge ?? 'correction' }
  }
  // Gate by blast radius, not by confidence: a failure the graph does not handle is unverified
  // work, and unverified work never advances on its own.
  return {
    kind: 'gate',
    reason: 'unverified',
    detail: correction
      ? `${stageKey} failed, and its correction stage ${correction.key} is on no board column.`
      : `${stageKey} failed, and the workflow has no correction edge out of it.`
  }
}
