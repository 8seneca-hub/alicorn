import { describe, expect, it } from 'vitest'
import { evaluateGate } from './evaluate-gate'
import type { AutonomyPolicy, GateEvidence, GateStep } from '../../../shared/alicorn/gate-policy'

const NOW = Date.parse('2026-09-08T12:00:00.000Z')
const now = () => NOW

function step(overrides: Partial<GateStep> = {}): GateStep {
  return { stageKey: 'build', reversibility: 'contained', inheritedCost: 'low', ...overrides }
}

function policy(overrides: Partial<AutonomyPolicy> = {}): AutonomyPolicy {
  return {
    projectId: 'repo-1',
    stageKey: 'build',
    memberId: null,
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

/** Everything known and good: the only input shape that may reach `auto`. */
function cleanEvidence(overrides: Partial<GateEvidence> = {}): GateEvidence {
  return {
    allRequiredChecksPassed: true,
    filesChanged: 3,
    spendCents: 100,
    touchedProtectedPath: false,
    stats: { runs: 50, acceptRate: 0.99, recentRegression: false },
    ...overrides
  }
}

describe('evaluateGate', () => {
  it('auto-approves only when every input is known and inside every budget', () => {
    expect(
      evaluateGate(step(), policy({ maxFiles: 10, maxSpendCents: 1000 }), cleanEvidence(), { now })
    ).toEqual({
      decision: 'auto',
      reason: 'auto'
    })
  })

  describe('order', () => {
    it('checks always_gate before anything else', () => {
      expect(
        evaluateGate(
          step({ reversibility: 'irreversible' }),
          policy({ mode: 'always_gate' }),
          cleanEvidence(),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'policy' })
    })

    it('checks irreversible before inherited cost', () => {
      expect(
        evaluateGate(
          step({ reversibility: 'irreversible', inheritedCost: 'high' }),
          policy(),
          cleanEvidence(),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'irreversible' })
    })

    it('checks inherited cost before the evidence checks', () => {
      expect(
        evaluateGate(
          step({ inheritedCost: 'high' }),
          policy(),
          cleanEvidence({ allRequiredChecksPassed: false }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'inherited' })
    })

    it('checks required checks before the blast-radius budgets', () => {
      expect(
        evaluateGate(
          step(),
          policy({ maxFiles: 1 }),
          cleanEvidence({ allRequiredChecksPassed: false, filesChanged: 99 }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'unverified' })
    })

    it('checks the file budget before the spend budget', () => {
      expect(
        evaluateGate(
          step(),
          policy({ maxFiles: 1, maxSpendCents: 1 }),
          cleanEvidence({ filesChanged: 99, spendCents: 99 }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'blast:files' })
    })

    it('checks the spend budget before protected-path reach', () => {
      expect(
        evaluateGate(
          step(),
          policy({ maxSpendCents: 1 }),
          cleanEvidence({ spendCents: 99, touchedProtectedPath: true }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'blast:spend' })
    })

    it('checks protected-path reach before the track record', () => {
      expect(
        evaluateGate(step(), policy(), cleanEvidence({ touchedProtectedPath: true, stats: null }), {
          now
        })
      ).toEqual({ decision: 'gate', reason: 'blast:reach' })
    })

    it('checks run count before accept rate', () => {
      expect(
        evaluateGate(
          step(),
          policy(),
          cleanEvidence({ stats: { runs: 2, acceptRate: 0.1, recentRegression: true } }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'history' })
    })

    it('checks accept rate before a recent regression', () => {
      expect(
        evaluateGate(
          step(),
          policy(),
          cleanEvidence({ stats: { runs: 50, acceptRate: 0.5, recentRegression: true } }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'accept-rate' })
    })

    it('gates on a recent regression last', () => {
      expect(
        evaluateGate(
          step(),
          policy(),
          cleanEvidence({ stats: { runs: 50, acceptRate: 0.99, recentRegression: true } }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'regression' })
    })
  })

  describe('hard stops never retire', () => {
    it.each(['irreversible', 'inherited'] as const)(
      'gates a %s step no matter how good the track record is',
      (reason) => {
        const hardStop =
          reason === 'irreversible'
            ? step({ reversibility: 'irreversible' })
            : step({ inheritedCost: 'high' })
        expect(
          evaluateGate(
            hardStop,
            policy({ minRuns: 0, minAcceptRate: 0 }),
            cleanEvidence({ stats: { runs: 10_000, acceptRate: 1, recentRegression: false } }),
            { now }
          )
        ).toEqual({ decision: 'gate', reason })
      }
    )

    it('gates an irreversible step even under an unexpired never_gate exception', () => {
      expect(
        evaluateGate(
          step({ reversibility: 'irreversible' }),
          policy({ mode: 'never_gate', expiresAt: '2026-10-01T00:00:00.000Z' }),
          cleanEvidence(),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'irreversible' })
    })

    it('gates a high inherited-cost step even under an unexpired never_gate exception', () => {
      expect(
        evaluateGate(
          step({ inheritedCost: 'high' }),
          policy({ mode: 'never_gate', expiresAt: '2026-10-01T00:00:00.000Z' }),
          cleanEvidence(),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'inherited' })
    })
  })

  describe('never_gate', () => {
    it('skips the evidence checks while it is unexpired', () => {
      expect(
        evaluateGate(
          step(),
          policy({ mode: 'never_gate', expiresAt: '2026-10-01T00:00:00.000Z' }),
          {
            allRequiredChecksPassed: null,
            filesChanged: null,
            spendCents: null,
            touchedProtectedPath: null,
            stats: null
          },
          { now }
        )
      ).toEqual({ decision: 'auto', reason: 'never_gate' })
    })

    it('falls back to the evidence checks once it has lapsed', () => {
      expect(
        evaluateGate(
          step(),
          policy({ mode: 'never_gate', expiresAt: '2026-09-01T00:00:00.000Z' }),
          cleanEvidence({ allRequiredChecksPassed: false }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'unverified' })
    })

    it('treats an exception expiring exactly now as lapsed', () => {
      expect(
        evaluateGate(
          step(),
          policy({ mode: 'never_gate', expiresAt: new Date(NOW).toISOString() }),
          cleanEvidence(),
          { now }
        )
      ).toEqual({ decision: 'auto', reason: 'auto' })
    })

    it('treats an unparseable expiry as lapsed rather than as permission', () => {
      expect(
        evaluateGate(
          step(),
          policy({ mode: 'never_gate', expiresAt: 'whenever' }),
          cleanEvidence({ allRequiredChecksPassed: null }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'unverified' })
    })
  })

  describe('unknown evidence is not permission', () => {
    it('gates when the required checks are unknown', () => {
      expect(
        evaluateGate(step(), policy(), cleanEvidence({ allRequiredChecksPassed: null }), { now })
      ).toEqual({ decision: 'gate', reason: 'unverified' })
    })

    it('gates when a file budget exists and the file count is unknown', () => {
      expect(
        evaluateGate(step(), policy({ maxFiles: 10 }), cleanEvidence({ filesChanged: null }), {
          now
        })
      ).toEqual({ decision: 'gate', reason: 'blast:files' })
    })

    it('ignores an unknown file count when no file budget is set', () => {
      expect(
        evaluateGate(step(), policy(), cleanEvidence({ filesChanged: null }), { now })
      ).toEqual({ decision: 'auto', reason: 'auto' })
    })

    it('gates when a spend budget exists and the spend is unknown', () => {
      expect(
        evaluateGate(step(), policy({ maxSpendCents: 500 }), cleanEvidence({ spendCents: null }), {
          now
        })
      ).toEqual({ decision: 'gate', reason: 'blast:spend' })
    })

    it('gates as unverified when protected-path reach could not be computed', () => {
      expect(
        evaluateGate(step(), policy(), cleanEvidence({ touchedProtectedPath: null }), { now })
      ).toEqual({ decision: 'gate', reason: 'unverified' })
    })

    it('gates on history when there is no track record at all', () => {
      expect(evaluateGate(step(), policy(), cleanEvidence({ stats: null }), { now })).toEqual({
        decision: 'gate',
        reason: 'history'
      })
    })
  })

  describe('budget boundaries', () => {
    it('allows a file count equal to the budget and gates one above it', () => {
      expect(
        evaluateGate(step(), policy({ maxFiles: 3 }), cleanEvidence({ filesChanged: 3 }), { now })
          .decision
      ).toBe('auto')
      expect(
        evaluateGate(step(), policy({ maxFiles: 3 }), cleanEvidence({ filesChanged: 4 }), { now })
      ).toEqual({ decision: 'gate', reason: 'blast:files' })
    })

    it('allows an accept rate equal to the minimum and gates just below it', () => {
      const atMinimum = { runs: 50, acceptRate: 0.9, recentRegression: false }
      expect(
        evaluateGate(step(), policy(), cleanEvidence({ stats: atMinimum }), { now }).decision
      ).toBe('auto')
      expect(
        evaluateGate(
          step(),
          policy(),
          cleanEvidence({ stats: { ...atMinimum, acceptRate: 0.89 } }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'accept-rate' })
    })

    it('allows a run count equal to the minimum and gates just below it', () => {
      expect(
        evaluateGate(
          step(),
          policy({ minRuns: 10 }),
          cleanEvidence({ stats: { runs: 10, acceptRate: 1, recentRegression: false } }),
          { now }
        ).decision
      ).toBe('auto')
      expect(
        evaluateGate(
          step(),
          policy({ minRuns: 10 }),
          cleanEvidence({ stats: { runs: 9, acceptRate: 1, recentRegression: false } }),
          { now }
        )
      ).toEqual({ decision: 'gate', reason: 'history' })
    })
  })

  it('is pure — it mutates neither the step, the policy nor the evidence', () => {
    const s = step()
    const p = policy({ maxFiles: 1 })
    const e = cleanEvidence({ filesChanged: 50 })
    const snapshot = JSON.stringify([s, p, e])
    evaluateGate(s, p, e, { now })
    expect(JSON.stringify([s, p, e])).toBe(snapshot)
  })
})
