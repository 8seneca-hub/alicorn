import { describe, expect, it } from 'vitest'
import { columnAdvanceIsLegal, gateReasonFor, planStageAdvance } from './workflow-gate'
import type { AutonomyPolicy } from './gate-policy'
import type { WorkflowStage } from './workflows'

function stage(
  over: Partial<WorkflowStage> & Pick<WorkflowStage, 'key' | 'ordinal'>
): WorkflowStage {
  return {
    name: over.key,
    memberId: null,
    columnId: null,
    kind: 'worker',
    codeCommand: null,
    reversibility: 'contained',
    inheritedCost: 'low',
    requiredChecks: [],
    ...over
  }
}

function policy(over: Partial<AutonomyPolicy> & Pick<AutonomyPolicy, 'stageKey'>): AutonomyPolicy {
  return {
    projectId: 'prj_1',
    memberId: null,
    mode: 'evidence',
    minRuns: 10,
    minAcceptRate: 0.9,
    maxFiles: null,
    maxSpendCents: null,
    createdBy: 'huy',
    createdAt: '2026-09-13T00:00:00.000Z',
    expiresAt: null,
    ...over
  }
}

// Spec → Build → Merge, which is the shape every question below is asked against.
const STAGES = [
  stage({ key: 'spec', ordinal: 0, columnId: 'todo' }),
  stage({ key: 'build', ordinal: 1, columnId: 'in-progress' }),
  stage({ key: 'merge', ordinal: 2, columnId: 'completed', reversibility: 'irreversible' })
]
const OPEN = [policy({ stageKey: 'spec' }), policy({ stageKey: 'build' })]

describe('what gates a stage', () => {
  it('gates an irreversible stage whatever the policy says', () => {
    expect(gateReasonFor(STAGES[2]!, [policy({ stageKey: 'merge', mode: 'evidence' })])).toBe(
      'irreversible'
    )
  })

  it('gates a stage whose cost everything after it inherits', () => {
    const arch = stage({ key: 'architecture', ordinal: 1, inheritedCost: 'high' })
    expect(gateReasonFor(arch, [policy({ stageKey: 'architecture', mode: 'evidence' })])).toBe(
      'inherited_cost'
    )
  })

  // The absence of a decision is not permission.
  it('gates a stage nobody authored a policy for', () => {
    expect(gateReasonFor(STAGES[1]!, [])).toBe('no_policy')
  })

  it('lets an ordinary stage through once the project has authored evidence', () => {
    expect(gateReasonFor(STAGES[1]!, OPEN)).toBeNull()
  })

  it('prefers a member-specific policy over the wildcard', () => {
    const narrowed = [
      policy({ stageKey: 'build', mode: 'evidence' }),
      policy({ stageKey: 'build', memberId: 'mem_1', mode: 'always_gate' })
    ]
    expect(gateReasonFor(STAGES[1]!, narrowed)).toBe('policy')
  })
})

describe('advancing a stage', () => {
  it('starts an unstarted task at the first stage', () => {
    expect(planStageAdvance({ stages: STAGES, policies: OPEN, from: null })).toEqual({
      kind: 'advance',
      to: STAGES[0]
    })
  })

  it('moves one stage, never two', () => {
    const result = planStageAdvance({ stages: STAGES, policies: OPEN, from: 'spec' })
    expect(result).toEqual({ kind: 'advance', to: STAGES[1] })
  })

  // The whole point: Claude asks for the next stage and is told no.
  it('refuses to enter a gated stage, and says why', () => {
    const result = planStageAdvance({ stages: STAGES, policies: OPEN, from: 'build' })
    expect(result).toEqual({ kind: 'gated', to: STAGES[2], reason: 'irreversible' })
  })

  it('reports the end of the pipeline rather than inventing a stage', () => {
    expect(planStageAdvance({ stages: STAGES, policies: OPEN, from: 'merge' })).toEqual({
      kind: 'finished'
    })
  })

  it('reads ordinals, not array order', () => {
    const shuffled = [STAGES[2]!, STAGES[0]!, STAGES[1]!]
    expect(planStageAdvance({ stages: shuffled, policies: OPEN, from: 'spec' })).toEqual({
      kind: 'advance',
      to: STAGES[1]
    })
  })

  it('says so when the task sits at a stage this workflow does not have', () => {
    expect(planStageAdvance({ stages: STAGES, policies: OPEN, from: 'ghost' })).toEqual({
      kind: 'unknown-stage'
    })
  })
})

describe('moving the board', () => {
  // An agent that cannot skip through advance_stage must not be able to skip by dragging.
  it('refuses a column two stages ahead', () => {
    expect(columnAdvanceIsLegal({ stages: STAGES, from: 'spec', toColumn: 'completed' })).toBe(
      false
    )
  })

  it('allows the next stage’s column', () => {
    expect(columnAdvanceIsLegal({ stages: STAGES, from: 'spec', toColumn: 'in-progress' })).toBe(
      true
    )
  })

  it('allows moving back', () => {
    expect(columnAdvanceIsLegal({ stages: STAGES, from: 'build', toColumn: 'todo' })).toBe(true)
  })

  it('ignores a column no stage dispatches', () => {
    expect(columnAdvanceIsLegal({ stages: STAGES, from: 'spec', toColumn: 'in-review' })).toBe(true)
  })
})
