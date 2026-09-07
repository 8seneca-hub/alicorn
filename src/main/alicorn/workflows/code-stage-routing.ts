import type { Workflow, WorkflowStage } from '../../../shared/alicorn/workflows'

/**
 * Where a finished code stage hands the workspace next.
 *
 * `none` is a stage that finished with nowhere to go — the end of the chain. `gate` is a failure
 * the graph does not handle, which is the case that must reach a human: a deterministic step failed
 * and no correction edge says what to do about it, so nothing may quietly carry on.
 */
export type CodeStageRoute =
  | { kind: 'move'; toStatusId: string; edge: 'forward' | 'correction' }
  | { kind: 'gate'; reason: 'unverified'; detail: string }
  | { kind: 'none' }

type WorkflowGraph = Pick<Workflow, 'stages' | 'transitions'>

function targetStage(workflow: WorkflowGraph, from: string, trigger: string): WorkflowStage | null {
  // The contract rejects two edges of one trigger out of one stage, so the first is the only one.
  const edge = workflow.transitions.find(
    (candidate) => candidate.from === from && candidate.trigger.kind === trigger
  )
  return edge ? (workflow.stages.find((stage) => stage.key === edge.to) ?? null) : null
}

export function routeCodeStage(
  workflow: WorkflowGraph,
  stageKey: string,
  outcome: 'succeeded' | 'failed'
): CodeStageRoute {
  if (outcome === 'succeeded') {
    const next = targetStage(workflow, stageKey, 'on_success')
    // A terminal stage, or one handing to a stage no board column shows, has nowhere to move to.
    // That is the end of the chain rather than something to interrupt anyone over.
    return next?.columnId
      ? { kind: 'move', toStatusId: next.columnId, edge: 'forward' }
      : { kind: 'none' }
  }
  // The correction edge — a deterministic step failed, and the graph says where that goes back to.
  const correction = targetStage(workflow, stageKey, 'on_failure')
  if (correction?.columnId) {
    return { kind: 'move', toStatusId: correction.columnId, edge: 'correction' }
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
