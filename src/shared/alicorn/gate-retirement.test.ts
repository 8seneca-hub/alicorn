import { describe, expect, it } from 'vitest'
import { RETIREMENT_LEVEL, resolveGateRetirement } from './gate-retirement'
import type { GateRetirementInput } from './gate-retirement'
import type { AutonomyPolicy, GateStep, TrackRecord } from './gate-policy'

function step(overrides: Partial<GateStep> = {}): GateStep {
  return { stageKey: 'build', reversibility: 'contained', inheritedCost: 'low', ...overrides }
}

function policy(overrides: Partial<AutonomyPolicy> = {}): AutonomyPolicy {
  return {
    projectId: 'repo-1',
    stageKey: 'build',
    memberId: 'mem_1',
    mode: 'evidence',
    minRuns: 10,
    minAcceptRate: 0.9,
    maxFiles: null,
    maxSpendCents: null,
    createdBy: 'admin',
    createdAt: '2026-09-01T00:00:00.000Z',
    expiresAt: null,
    ...overrides
  }
}

/** A record that has genuinely reached level 3 — the only shape that may retire anything. */
function earnedRecord(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    memberId: 'mem_1',
    stageKey: 'build',
    projectId: 'repo-1',
    runs: 50,
    accepted: 49,
    rejected: 0,
    amended: 1,
    acceptRate: 0.98,
    recentRegression: false,
    lastAmendedAt: '2026-07-01T00:00:00.000Z',
    level: 3,
    amendmentsObserved: true,
    demotionReason: null,
    ...overrides
  }
}

function input(overrides: Partial<GateRetirementInput> = {}): GateRetirementInput {
  return {
    step: step(),
    policy: policy(),
    decision: { decision: 'auto', reason: 'auto' },
    trackRecord: earnedRecord(),
    stageKeyAuthored: true,
    ...overrides
  }
}

describe('resolveGateRetirement', () => {
  it('retires only when every condition is met at once', () => {
    expect(resolveGateRetirement(input())).toEqual({ retire: true, level: RETIREMENT_LEVEL })
  })

  describe('hard stops never retire', () => {
    it('refuses an irreversible stage on a perfect 500-run record', () => {
      expect(
        resolveGateRetirement(
          input({
            step: step({ stageKey: 'merge', reversibility: 'irreversible' }),
            trackRecord: earnedRecord({
              runs: 500,
              accepted: 500,
              amended: 0,
              acceptRate: 1,
              lastAmendedAt: null
            })
          })
        )
      ).toEqual({ retire: false, refusal: 'hard-stop:irreversible' })
    })

    it('refuses an inherited-cost stage on a perfect 500-run record', () => {
      expect(
        resolveGateRetirement(
          input({
            step: step({ stageKey: 'architecture', inheritedCost: 'high' }),
            trackRecord: earnedRecord({ runs: 500, accepted: 500, acceptRate: 1 })
          })
        )
      ).toEqual({ retire: false, refusal: 'hard-stop:inherited' })
    })

    it('refuses a hard stop even if some other function wrongly decided auto for it', () => {
      // The hard stops are re-checked here rather than trusted through `decision`, so an
      // irreversible stage stays gated even when the decision handed in says otherwise.
      expect(
        resolveGateRetirement(
          input({
            step: step({ reversibility: 'irreversible', inheritedCost: 'high' }),
            decision: { decision: 'auto', reason: 'auto' }
          })
        )
      ).toEqual({ retire: false, refusal: 'hard-stop:irreversible' })
    })

    it('checks the hard stops before the policy, so neither can be ordered away', () => {
      expect(
        resolveGateRetirement(
          input({ step: step({ inheritedCost: 'high' }), policy: policy({ mode: 'always_gate' }) })
        )
      ).toEqual({ retire: false, refusal: 'hard-stop:inherited' })
    })
  })

  describe('inert until the evidence is genuinely there', () => {
    it('does NOT retire a spotless but short record', () => {
      // The case that matters most: 49 runs, not one of them faulted, and it still gates.
      expect(
        resolveGateRetirement(
          input({
            trackRecord: earnedRecord({
              runs: 49,
              accepted: 49,
              amended: 0,
              acceptRate: 1,
              lastAmendedAt: null,
              level: 2
            })
          })
        )
      ).toEqual({ retire: false, refusal: 'level' })
    })

    it.each([0, 1, 2])('does NOT retire at level %i', (level) => {
      expect(resolveGateRetirement(input({ trackRecord: earnedRecord({ level }) }))).toEqual({
        retire: false,
        refusal: 'level'
      })
    })

    it('does NOT retire when the ledger could not be read', () => {
      expect(resolveGateRetirement(input({ trackRecord: null }))).toEqual({
        retire: false,
        refusal: 'no-record'
      })
    })

    it('does NOT retire when the policy itself would have gated', () => {
      expect(
        resolveGateRetirement(input({ decision: { decision: 'gate', reason: 'unverified' } }))
      ).toEqual({ retire: false, refusal: 'not-earned' })
    })

    it('does NOT retire on a standing never_gate exception — that is authored, not earned', () => {
      expect(
        resolveGateRetirement(
          input({
            policy: policy({ mode: 'never_gate', expiresAt: '2099-01-01T00:00:00.000Z' }),
            decision: { decision: 'auto', reason: 'never_gate' }
          })
        )
      ).toEqual({ retire: false, refusal: 'not-earned' })
    })

    it('does NOT retire under an always_gate policy', () => {
      expect(resolveGateRetirement(input({ policy: policy({ mode: 'always_gate' }) }))).toEqual({
        retire: false,
        refusal: 'policy'
      })
    })
  })

  describe('a window keyed on free text is not evidence', () => {
    it('does NOT retire an unauthored stage key, however long its record', () => {
      expect(
        resolveGateRetirement(
          input({
            step: step({ stageKey: 'reveiw' }),
            stageKeyAuthored: false,
            trackRecord: earnedRecord({ runs: 500, accepted: 500, acceptRate: 1 })
          })
        )
      ).toEqual({ retire: false, refusal: 'stage-key-unauthored' })
    })
  })

  describe('demotion is asymmetric', () => {
    it('returns the gate immediately on a regression, at any accumulated record', () => {
      expect(
        resolveGateRetirement(
          input({
            trackRecord: earnedRecord({
              runs: 500,
              accepted: 499,
              rejected: 1,
              acceptRate: 0.998,
              recentRegression: true,
              demotionReason: 'rejection',
              // Level would have been demoted to 2 by `computeAutonomyLevel` too; the refusal is
              // reported as `demoted`, not `level`, so the human is told the gate *came back*.
              level: 2
            })
          })
        )
      ).toEqual({ retire: false, refusal: 'demoted' })
    })

    it('reports demotion rather than level even when the level still reads 3', () => {
      expect(
        resolveGateRetirement(
          input({
            trackRecord: earnedRecord({ recentRegression: true, demotionReason: 'amendments' })
          })
        )
      ).toEqual({ retire: false, refusal: 'demoted' })
    })
  })
})

describe('refusal precedence', () => {
  it('reports demotion ahead of the generic "the policy gated"', () => {
    // A demoted stage also fails `evaluateGate` on `regression`, so both refusals apply. The
    // human needs the one that says the gate *came back*.
    expect(
      resolveGateRetirement(
        input({
          decision: { decision: 'gate', reason: 'regression' },
          trackRecord: earnedRecord({ recentRegression: true, demotionReason: 'rejection' })
        })
      )
    ).toEqual({ retire: false, refusal: 'demoted' })
  })

  it('still reports the hard stop ahead of a demotion', () => {
    expect(
      resolveGateRetirement(
        input({
          step: step({ reversibility: 'irreversible' }),
          decision: { decision: 'gate', reason: 'irreversible' },
          trackRecord: earnedRecord({ recentRegression: true })
        })
      )
    ).toEqual({ retire: false, refusal: 'hard-stop:irreversible' })
  })
})
