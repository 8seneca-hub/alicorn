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
    { from: 'format', to: 'qa', trigger: { kind: 'on_success' } },
    { from: 'format', to: 'build', trigger: { kind: 'on_failure' } }
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
      { ...GRAPH, transitions: [{ from: 'format', to: 'qa', trigger: { kind: 'on_success' } }] },
      'format',
      'failed'
    )

    expect(route).toMatchObject({ kind: 'gate', reason: 'unverified' })
  })

  it('gates a failure whose correction stage sits on no board column', () => {
    const route = routeCodeStage(
      {
        stages: [stage('format', 'in-review'), stage('triage', null)],
        transitions: [{ from: 'format', to: 'triage', trigger: { kind: 'on_failure' } }]
      },
      'format',
      'failed'
    )

    expect(route).toMatchObject({ kind: 'gate', reason: 'unverified' })
    expect(route).toHaveProperty('detail', expect.stringContaining('triage'))
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
        transitions: [{ from: 'format', to: 'archive', trigger: { kind: 'on_success' } }]
      },
      'format',
      'succeeded'
    )

    expect(route).toEqual({ kind: 'none' })
  })

  it('ignores a manual edge out of the stage', () => {
    const route = routeCodeStage(
      { ...GRAPH, transitions: [{ from: 'format', to: 'qa', trigger: { kind: 'manual' } }] },
      'format',
      'succeeded'
    )

    expect(route).toEqual({ kind: 'none' })
  })
})
