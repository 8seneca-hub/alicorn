import { describe, expect, it } from 'vitest'
import { correctionTo, forwardTo, newStage, patchStage, type WorkflowDraft } from './workflow-draft'
import {
  issuesForStage,
  issuesForTransition,
  renamedStageKeys,
  validateDraft
} from './workflow-draft-validation'

function draft(over: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    projectId: 'p1',
    name: 'Feature delivery',
    stages: [newStage('spec', 0), newStage('build', 1), newStage('review', 2)],
    transitions: [
      forwardTo('spec', 'build'),
      forwardTo('build', 'review'),
      correctionTo('review', 'build')
    ],
    ...over
  }
}

const codes = (issues: readonly { code: string }[]): string[] => issues.map((issue) => issue.code)

describe('validateDraft', () => {
  it('passes a graph with a correction edge — a cycle is legal', () => {
    expect(validateDraft(draft())).toEqual([])
  })

  it('rejects a correction edge that runs onward', () => {
    const issues = validateDraft(
      draft({ transitions: [{ ...correctionTo('spec', 'build'), kind: 'correction' }] })
    )
    expect(codes(issues)).toContain('correction_edge_must_return')
  })

  it('rejects a forward edge that returns', () => {
    const issues = validateDraft(
      draft({ transitions: [{ ...correctionTo('review', 'spec'), kind: 'forward' }] })
    )
    expect(codes(issues)).toContain('forward_edge_must_not_return')
  })

  it('reports an edge whose endpoint is not on the canvas', () => {
    expect(codes(validateDraft(draft({ transitions: [forwardTo('spec', 'ghost')] })))).toEqual([
      'unknown_stage_key'
    ])
  })

  it('reports two edges out of one stage on the same trigger', () => {
    const issues = validateDraft(
      draft({ transitions: [forwardTo('spec', 'build'), forwardTo('spec', 'review')] })
    )
    expect(codes(issues)).toContain('ambiguous_trigger')
  })

  it('reports a duplicate stage key', () => {
    const issues = validateDraft(draft({ stages: [newStage('spec', 0), newStage('spec', 1)] }))
    expect(codes(issues)).toContain('duplicate_stage_key')
  })

  it('reports a stage key the ledger could never read back', () => {
    const issues = validateDraft(draft({ stages: [newStage('Review Stage', 0)], transitions: [] }))
    expect(codes(issues)).toContain('invalid_stage_key')
  })

  it('reports a code stage with no command and one carrying a member', () => {
    const withCode = patchStage(draft({ transitions: [] }), 'build', { kind: 'code' })
    expect(codes(validateDraft(withCode))).toContain('code_stage_requires_command')
    const withMember = {
      ...withCode,
      stages: withCode.stages.map((s) =>
        s.key === 'build' ? { ...s, memberId: 'm1', codeCommand: 'x' } : s
      )
    }
    expect(codes(validateDraft(withMember))).toContain('code_stage_takes_no_member')
  })

  it('reports a graph with no name and no stages', () => {
    expect(codes(validateDraft(draft({ name: '  ', stages: [], transitions: [] })))).toEqual([
      'name_required',
      'stages_required'
    ])
  })
})

describe('issue lookup', () => {
  it('finds the issues attached to one stage and one edge', () => {
    const broken = draft({
      stages: [newStage('spec', 0), newStage('build', 1)],
      transitions: [{ ...correctionTo('spec', 'build'), kind: 'correction' }]
    })
    const issues = validateDraft(broken)
    expect(issuesForTransition(issues, 'spec', 'build')).toHaveLength(1)
    expect(issuesForStage(issues, 'spec')).toEqual([])
  })
})

describe('renamedStageKeys', () => {
  // SK1: the evidence stays on the old key, so the renamed stage starts with none.
  it('names the saved keys the draft no longer has', () => {
    const renamed = draft({
      stages: [newStage('spec', 0), newStage('implement', 1), newStage('review', 2)],
      transitions: []
    })
    expect(
      renamedStageKeys([{ key: 'spec' }, { key: 'build' }, { key: 'review' }], renamed)
    ).toEqual(['build'])
  })

  it('says nothing when only a name changed', () => {
    const renamed = { ...draft(), stages: draft().stages.map((s) => ({ ...s, name: 'Renamed' })) }
    expect(
      renamedStageKeys([{ key: 'spec' }, { key: 'build' }, { key: 'review' }], renamed)
    ).toEqual([])
  })
})
