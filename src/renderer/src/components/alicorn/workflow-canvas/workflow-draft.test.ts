import { describe, expect, it } from 'vitest'
import {
  addStage,
  correctionTo,
  forwardTo,
  moveStage,
  newStage,
  patchStage,
  removeStage,
  removeTransition,
  renameStageKey,
  suggestKind,
  upsertTransition,
  type WorkflowDraft
} from './workflow-draft'

function draft(): WorkflowDraft {
  return {
    projectId: 'p1',
    name: 'Feature delivery',
    stages: [newStage('spec', 0), newStage('build', 1), newStage('review', 2)],
    transitions: [
      forwardTo('spec', 'build'),
      forwardTo('build', 'review'),
      correctionTo('review', 'build')
    ]
  }
}

describe('newStage', () => {
  it('starts a stage on the safe side of both authored fields', () => {
    const stage = newStage('build', 0)
    expect(stage.reversibility).toBe('contained')
    expect(stage.inheritedCost).toBe('low')
  })
})

describe('patchStage', () => {
  it('clears the member when a stage becomes a code stage', () => {
    const withMember = patchStage(draft(), 'build', { memberId: 'm1' })
    const next = patchStage(withMember, 'build', { kind: 'code', codeCommand: 'pnpm format' })
    expect(next.stages.find((s) => s.key === 'build')).toMatchObject({
      kind: 'code',
      memberId: null,
      codeCommand: 'pnpm format'
    })
  })

  it('clears the command when a code stage becomes a worker stage', () => {
    const code = patchStage(draft(), 'build', { kind: 'code', codeCommand: 'pnpm format' })
    expect(patchStage(code, 'build', { kind: 'worker' }).stages[1]).toMatchObject({
      kind: 'worker',
      codeCommand: null
    })
  })

  it('authors reversibility and inherited cost without touching anything else', () => {
    const next = patchStage(draft(), 'review', {
      reversibility: 'irreversible',
      inheritedCost: 'high'
    })
    expect(next.stages.find((s) => s.key === 'review')).toMatchObject({
      reversibility: 'irreversible',
      inheritedCost: 'high'
    })
    expect(next.transitions).toEqual(draft().transitions)
  })

  it('does not mutate the draft it was given', () => {
    const before = draft()
    patchStage(before, 'build', { reversibility: 'irreversible' })
    expect(before.stages[1]!.reversibility).toBe('contained')
  })
})

describe('renameStageKey', () => {
  it('re-points every edge, correction edges included', () => {
    const next = renameStageKey(draft(), 'build', 'implement')
    expect(next.stages.map((s) => s.key)).toEqual(['spec', 'implement', 'review'])
    expect(next.transitions).toEqual([
      { from: 'spec', to: 'implement', kind: 'forward', trigger: { kind: 'on_success' } },
      { from: 'implement', to: 'review', kind: 'forward', trigger: { kind: 'on_success' } },
      { from: 'review', to: 'implement', kind: 'correction', trigger: { kind: 'on_failure' } }
    ])
  })
})

describe('addStage and removeStage', () => {
  it('inserts after the named ordinal and keeps ordinals contiguous', () => {
    const next = addStage(draft(), 'design', 0)
    expect(next.stages.map((s) => [s.key, s.ordinal])).toEqual([
      ['spec', 0],
      ['design', 1],
      ['build', 2],
      ['review', 3]
    ])
  })

  it('appends when no position is named', () => {
    expect(addStage(draft(), 'merge').stages.at(-1)).toMatchObject({ key: 'merge', ordinal: 3 })
  })

  it('drops every edge touching a removed stage — a dangling edge is invisible', () => {
    const next = removeStage(draft(), 'build')
    expect(next.stages.map((s) => [s.key, s.ordinal])).toEqual([
      ['spec', 0],
      ['review', 1]
    ])
    expect(next.transitions).toEqual([])
  })
})

describe('moveStage', () => {
  it('swaps two stages and renumbers them', () => {
    expect(moveStage(draft(), 'review', -1).stages.map((s) => [s.key, s.ordinal])).toEqual([
      ['spec', 0],
      ['review', 1],
      ['build', 2]
    ])
  })

  it('refuses to move past either end', () => {
    const before = draft()
    expect(moveStage(before, 'spec', -1)).toBe(before)
    expect(moveStage(before, 'review', 1)).toBe(before)
  })

  // Re-deriving the kind would rewrite something a human authored; validation reports it instead.
  it('leaves an edge kind alone even when the reorder makes it point the wrong way', () => {
    const next = moveStage(draft(), 'review', -1)
    expect(next.transitions.find((t) => t.from === 'review')).toMatchObject({ kind: 'correction' })
  })
})

describe('transitions', () => {
  it('replaces an edge on the same pair rather than adding a second one', () => {
    const next = upsertTransition(draft(), correctionTo('build', 'spec'))
    const again = upsertTransition(next, {
      ...correctionTo('build', 'spec'),
      trigger: { kind: 'manual' }
    })
    expect(again.transitions.filter((t) => t.from === 'build' && t.to === 'spec')).toHaveLength(1)
    expect(again.transitions.at(-1)!.trigger).toEqual({ kind: 'manual' })
  })

  it('removes only the named pair', () => {
    expect(removeTransition(draft(), 'review', 'build').transitions).toHaveLength(2)
  })

  it('builds a correction edge as a return that fires on failure', () => {
    expect(correctionTo('review', 'build')).toEqual({
      from: 'review',
      to: 'build',
      kind: 'correction',
      trigger: { kind: 'on_failure' }
    })
  })
})

describe('suggestKind', () => {
  // A suggestion for a *new* edge only — the human can override it, and nothing re-derives later.
  it('suggests correction for an edge that goes back and forward for one that goes on', () => {
    expect(suggestKind(draft(), 'review', 'build')).toBe('correction')
    expect(suggestKind(draft(), 'spec', 'review')).toBe('forward')
  })
})
