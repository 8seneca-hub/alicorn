import { describe, expect, it } from 'vitest'
import type { Workflow, WorkflowStage } from '../../../shared/alicorn/workflows'
import { routeCodeStage } from './code-stage-routing'

function stage(key: string, columnId: string | null): WorkflowStage {
  return {
    key,
    name: key,
    ordinal: 0,
    memberId: null,
    columnId,
    kind: 'worker',
    codeCommand: null,
    reversibility: 'contained',
    inheritedCost: 'low',
    requiredChecks: []
  }
}

const GRAPH: Pick<Workflow, 'stages' | 'transitions'> = {
  stages: [stage('build', 'in-progress'), stage('format', 'in-review'), stage('qa', 'completed')],
  transitions: [
    { from: 'format', to: 'qa', kind: 'forward' as const, trigger: { kind: 'on_success' as const } },
    { from: 'format', to: 'build', kind: 'correction' as const, trigger: { kind: 'on_failure' as const } }
  ]
}

describe('routeCodeStage', () => {
  it('takes the forward edge on exit 0', () => {
    expect(routeCodeStage(GRAPH, 'format', 'succeeded')).toEqual({
      kind: 'move',
      toStatusId: 'completed',
      edge: 'forward'
    })
  })

  // The return edge is a first-class part of the graph, not an error path bolted on.
  it('takes the correction edge on a non-zero exit', () => {
    expect(routeCodeStage(GRAPH, 'format', 'failed')).toEqual({
      kind: 'move',
      toStatusId: 'in-progress',
      edge: 'correction'
    })
  })

  // Gate by blast radius, not by confidence: a failure the graph does not handle is unverified
  // work, and unverified work never advances on its own.
  it('gates a failure with no correction edge', () => {
    const route = routeCodeStage(
      { ...GRAPH, transitions: [{ from: 'format', to: 'qa', kind: 'forward' as const, trigger: { kind: 'on_success' as const } }] },
      'format',
      'failed'
    )

    expect(route).toMatchObject({ kind: 'gate', reason: 'unverified' })
  })

  it('gates a failure whose correction stage sits on no board column', () => {
    const route = routeCodeStage(
      {
        stages: [stage('format', 'in-review'), stage('triage', null)],
        transitions: [{ from: 'format', to: 'triage', kind: 'forward' as const, trigger: { kind: 'on_failure' as const } }]
      },
      'format',
      'failed'
    )

    expect(route).toMatchObject({ kind: 'gate', reason: 'unverified' })
    expect(route).toHaveProperty('detail', expect.stringContaining('triage'))
  })

  // The kind is authored on the edge (WF2), so an on_failure edge to a triage stage reports what
  // the author said it was rather than what the trigger implies.
  it('reports the authored edge kind, not one inferred from the trigger', () => {
    const route = routeCodeStage(
      {
        stages: [stage('format', 'in-review'), stage('triage', 'todo')],
        transitions: [
          { from: 'format', to: 'triage', kind: 'forward' as const, trigger: { kind: 'on_failure' as const } }
        ]
      },
      'format',
      'failed'
    )

    expect(route).toEqual({ kind: 'move', toStatusId: 'todo', edge: 'forward' })
  })

  // A terminal stage is the end of the chain, not something to interrupt anyone over.
  it('moves nowhere when a stage succeeds with no forward edge', () => {
    expect(routeCodeStage({ ...GRAPH, transitions: [] }, 'format', 'succeeded')).toEqual({
      kind: 'none'
    })
  })

  it('moves nowhere when the next stage sits on no board column', () => {
    const route = routeCodeStage(
      {
        stages: [stage('format', 'in-review'), stage('archive', null)],
        transitions: [{ from: 'format', to: 'archive', kind: 'forward' as const, trigger: { kind: 'on_success' as const } }]
      },
      'format',
      'succeeded'
    )

    expect(route).toEqual({ kind: 'none' })
  })

  it('ignores a manual edge out of the stage', () => {
    const route = routeCodeStage(
      { ...GRAPH, transitions: [{ from: 'format', to: 'qa', kind: 'forward' as const, trigger: { kind: 'manual' as const } }] },
      'format',
      'succeeded'
    )

    expect(route).toEqual({ kind: 'none' })
  })
})
