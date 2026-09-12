import { describe, expect, it } from 'vitest'
import { resolveTaskStageKey } from './AlicornTaskHeader'
import type { WorkflowStage } from '../../../../../shared/alicorn/workflows'

function stage(key: string, columnId: string | null, ordinal: number): WorkflowStage {
  return {
    key,
    name: key,
    ordinal,
    memberId: null,
    columnId,
    kind: 'worker',
    codeCommand: null,
    reversibility: 'free',
    inheritedCost: 'low',
    requiredChecks: []
  }
}

const STAGES = [
  stage('spec', 'todo', 0),
  stage('architecture', null, 1),
  stage('build', 'in-progress', 2),
  stage('review', 'in-review', 3),
  stage('merge', 'completed', 4)
]

describe('which stage a task is at', () => {
  it('takes an explicit stageKey as the authority', () => {
    expect(resolveTaskStageKey(STAGES, { stageKey: 'review', column: 'todo' })).toBe('review')
  })

  // Nothing writes stageKey yet, so without this the rail reads "nothing has started" forever.
  it('falls back to the stage the task’s column dispatches', () => {
    expect(resolveTaskStageKey(STAGES, { stageKey: null, column: 'in-progress' })).toBe('build')
    expect(resolveTaskStageKey(STAGES, { stageKey: null, column: 'completed' })).toBe('merge')
  })

  it('answers null when no stage claims the column', () => {
    expect(resolveTaskStageKey(STAGES, { stageKey: null, column: 'done' })).toBeNull()
    expect(resolveTaskStageKey([], { stageKey: null, column: 'todo' })).toBeNull()
  })

  // A stage with no column never dispatches, so it must not be picked up by the fallback.
  it('ignores stages bound to no column', () => {
    expect(resolveTaskStageKey(STAGES, { stageKey: null, column: 'todo' })).toBe('spec')
  })
})
