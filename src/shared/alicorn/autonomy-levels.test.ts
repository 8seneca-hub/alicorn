import { describe, expect, it } from 'vitest'
import {
  AUTONOMY_LEVELS,
  levelOfPolicy,
  policyForLevel,
  SHIPPED_DEFAULT_LEVEL
} from './autonomy-levels'
import { gateReasonFor } from './workflow-gate'
import type { AutonomyPolicy } from './gate-policy'
import type { WorkflowStage } from './workflows'

function asPolicy(input: ReturnType<typeof policyForLevel>): AutonomyPolicy {
  return { ...input, projectId: 'prj_1', createdBy: 'huy', createdAt: '2026-09-13T00:00:00.000Z' }
}

describe('autonomy levels', () => {
  it('round-trips every level through the fields it is stored as', () => {
    for (const level of AUTONOMY_LEVELS) {
      expect(levelOfPolicy(asPolicy(policyForLevel({ level, stageKey: 'build' })))).toBe(level)
    }
  })

  it('reads an unauthored stage as what it inherits', () => {
    expect(levelOfPolicy(null)).toBe(SHIPPED_DEFAULT_LEVEL)
    expect(levelOfPolicy(null, 'L0')).toBe('L0')
  })

  // An authored stage is the project's own answer; the org's floor does not reach it.
  it('leaves an authored stage alone whatever the org default is', () => {
    const authored = asPolicy(policyForLevel({ level: 'L1', stageKey: 'build' }))
    expect(levelOfPolicy(authored, 'L0')).toBe('L1')
  })

  // L1 and L2 differ only by whether a track record has to be earned first.
  it('asks L2 for evidence and L1 for none', () => {
    expect(policyForLevel({ level: 'L1', stageKey: 'build' }).minRuns).toBe(0)
    expect(policyForLevel({ level: 'L2', stageKey: 'build' }).minRuns).toBeGreaterThan(0)
  })

  // §9: a standing exception always lapses, and the DB CHECK refuses one that does not.
  it('gives L3 an expiry, because never_gate may not stand forever', () => {
    const policy = policyForLevel({ level: 'L3', stageKey: 'build', now: () => 0 })
    expect(policy.mode).toBe('never_gate')
    expect(policy.expiresAt).not.toBeNull()
  })

  /**
   * The sentence under L3 in the UI, asserted rather than remembered: reversibility is read before
   * any policy, so no level reaches a hard stop.
   */
  it('still gates an irreversible stage at L3', () => {
    const merge: WorkflowStage = {
      key: 'merge',
      name: 'Merge',
      ordinal: 0,
      memberId: null,
      columnId: null,
      kind: 'worker',
      codeCommand: null,
      reversibility: 'irreversible',
      inheritedCost: 'low',
      requiredChecks: []
    }
    const autonomous = asPolicy(policyForLevel({ level: 'L3', stageKey: 'merge' }))
    expect(gateReasonFor(merge, [autonomous])).toBe('irreversible')
  })
})
