import { describe, expect, it } from 'vitest'
import { autonomyStarterSet } from './autonomy-starter-set'
import type { WorkflowStage } from './workflows'

function stage(over: Partial<WorkflowStage>): WorkflowStage {
  return {
    key: 'build',
    name: 'Build',
    ordinal: 0,
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

describe('the autonomy starter set', () => {
  it('authors one policy per stage, keyed by the stage', () => {
    const set = autonomyStarterSet([stage({ key: 'spec' }), stage({ key: 'build' })])
    expect(set.map((policy) => policy.stageKey)).toEqual(['spec', 'build'])
  })

  // Hard stops never retire: guessing wrong once is a production deploy.
  it('always gates an irreversible stage', () => {
    const [merge] = autonomyStarterSet([stage({ key: 'merge', reversibility: 'irreversible' })])
    expect(merge!.mode).toBe('always_gate')
  })

  it('always gates a stage whose cost is inherited by everything after it', () => {
    const [arch] = autonomyStarterSet([stage({ key: 'architecture', inheritedCost: 'high' })])
    expect(arch!.mode).toBe('always_gate')
  })

  it('leaves an ordinary stage on evidence, which still gates', () => {
    const [build] = autonomyStarterSet([stage({})])
    expect(build!.mode).toBe('evidence')
  })

  // never_gate needs an expiry by contract and by CHECK; a starter value must never need one.
  it('never authors a standing exception', () => {
    const set = autonomyStarterSet([
      stage({ key: 'spec', reversibility: 'free' }),
      stage({ key: 'deploy', reversibility: 'irreversible' })
    ])
    expect(set.every((policy) => policy.mode !== 'never_gate')).toBe(true)
    expect(set.every((policy) => policy.expiresAt === null)).toBe(true)
  })

  it('budgets only the stages that may run unattended', () => {
    const [build, merge] = autonomyStarterSet([
      stage({ key: 'build' }),
      stage({ key: 'merge', reversibility: 'irreversible' })
    ])
    expect(build!.maxFiles).toBe(25)
    expect(merge!.maxFiles).toBeNull()
  })
})
