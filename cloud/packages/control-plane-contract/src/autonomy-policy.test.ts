import { describe, expect, it } from 'vitest'
import {
  AutonomyPolicyInputSchema,
  GATE_DECISION_REASONS,
  StageConfigSchema,
  defaultStageConfig
} from './autonomy-policy.js'

describe('AutonomyPolicyInputSchema', () => {
  it('applies the documented defaults so a minimal policy is still complete', () => {
    expect(AutonomyPolicyInputSchema.parse({ mode: 'evidence' })).toEqual({
      stageKey: 'build',
      memberId: null,
      mode: 'evidence',
      minRuns: 10,
      minAcceptRate: 0.9,
      maxFiles: null,
      maxSpendCents: null,
      expiresAt: null
    })
  })

  // §9: a standing exception expires, or it is not an exception.
  it('rejects never_gate without an expiry', () => {
    const result = AutonomyPolicyInputSchema.safeParse({ mode: 'never_gate' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['expiresAt'])
  })

  it('accepts never_gate with an expiry', () => {
    expect(
      AutonomyPolicyInputSchema.parse({
        mode: 'never_gate',
        expiresAt: '2026-12-01T00:00:00.000Z'
      }).expiresAt
    ).toBe('2026-12-01T00:00:00.000Z')
  })

  it('accepts an expiry on the other policy modes without requiring one', () => {
    expect(AutonomyPolicyInputSchema.parse({ mode: 'always_gate' }).expiresAt).toBeNull()
  })

  it('rejects an accept rate outside 0..1 and a negative run floor', () => {
    expect(AutonomyPolicyInputSchema.safeParse({ mode: 'evidence', minAcceptRate: 1.5 }).success).toBe(false)
    expect(AutonomyPolicyInputSchema.safeParse({ mode: 'evidence', minRuns: -1 }).success).toBe(false)
  })

  it('rejects a malformed stage key', () => {
    expect(AutonomyPolicyInputSchema.safeParse({ mode: 'evidence', stageKey: 'Not A Stage' }).success).toBe(false)
  })
})

describe('defaultStageConfig', () => {
  // Guessing wrong once is a production deploy, so the unauthored default is the safe one.
  it.each(['merge', 'deploy'])('seeds %s irreversible and high inherited cost', (stageKey) => {
    expect(defaultStageConfig(stageKey)).toEqual({
      reversibility: 'irreversible',
      inheritedCost: 'high'
    })
  })

  it('seeds every other stage contained and low', () => {
    expect(defaultStageConfig('build')).toEqual({
      reversibility: 'contained',
      inheritedCost: 'low'
    })
  })

  it('produces a value the stage config schema accepts', () => {
    expect(StageConfigSchema.parse(defaultStageConfig('merge'))).toBeTruthy()
  })
})

describe('GATE_DECISION_REASONS', () => {
  // The order is ARCHITECTURE §7's evaluation order; a reader of the enum should see the policy.
  it('lists the hard stops before anything evidence can influence', () => {
    expect(GATE_DECISION_REASONS.slice(0, 4)).toEqual([
      'policy',
      'irreversible',
      'inherited',
      'never_gate'
    ])
    expect(GATE_DECISION_REASONS.at(-1)).toBe('auto')
  })
})
