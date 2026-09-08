import { describe, expect, it } from 'vitest'
import { buildProvenanceView, formatSpendCents, isGateDecisionReason } from './provenance-view'
import type { ProvenanceReport, StepOutcomeRecord } from './ledger'

function outcome(overrides: Partial<StepOutcomeRecord> = {}): StepOutcomeRecord {
  return {
    id: 'o1',
    tenantId: 'local',
    runId: 'run_1',
    taskId: 't1',
    dispatchId: 'd1',
    backend: 'claude',
    stageKey: 'build',
    executionStrategy: 'single',
    outcome: 'succeeded',
    filesModified: ['a.ts'],
    reviewBackendBypass: false,
    escalationOffered: false,
    escalationAccepted: null,
    spendCents: 61,
    usage: null,
    gateDecision: 'auto',
    gateReason: 'auto',
    gateId: null,
    policyRecommendation: null,
    policyRecommendationReason: null,
    humanGateDecision: null,
    agreedWithPolicy: null,
    recommendationShown: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    ...overrides
  }
}

function report(overrides: Partial<ProvenanceReport> = {}): ProvenanceReport {
  return {
    repoId: 'r1',
    branch: 'feature/x',
    outcomes: [outcome()],
    verifications: [],
    contextCaptures: [],
    totals: { spendCents: 61, tasks: 1, dispatches: 1 },
    reviewBackend: { enforced: true, bypassed: false },
    ...overrides
  }
}

describe('buildProvenanceView', () => {
  it('carries the gate decision and reason through per step', () => {
    const view = buildProvenanceView(
      report({
        outcomes: [
          outcome({ id: 'a', gateDecision: 'gate', gateReason: 'irreversible' }),
          outcome({ id: 'b', gateDecision: 'auto', gateReason: 'auto' })
        ]
      }),
      { policyEnforced: true }
    )
    expect(view.steps.map((step) => step.gate)).toEqual([
      { decision: 'gate', reason: 'irreversible' },
      { decision: 'auto', reason: 'auto' }
    ])
    expect(view.gateCounts).toEqual({ gate: 1, auto: 1, unknown: 0 })
  })

  it('reads an unrecognised decision or reason as unknown rather than as auto', () => {
    // A step written before GP1 carries no decision. Silence must never render as "no human needed".
    const view = buildProvenanceView(
      report({ outcomes: [outcome({ gateDecision: '', gateReason: '' })] }),
      { policyEnforced: true }
    )
    expect(view.steps[0]?.gate).toEqual({ decision: 'unknown', reason: 'unknown' })
    expect(view.gateCounts).toEqual({ gate: 0, auto: 0, unknown: 1 })
  })

  it('keeps a future reason it does not know out of the known set', () => {
    const view = buildProvenanceView(
      report({ outcomes: [outcome({ gateDecision: 'gate', gateReason: 'blast:something-new' })] }),
      { policyEnforced: true }
    )
    expect(view.steps[0]?.gate).toEqual({ decision: 'gate', reason: 'unknown' })
  })

  it('names the member when the directory knows it and leaves null when there is none', () => {
    const view = buildProvenanceView(
      report({
        outcomes: [outcome({ id: 'a', memberId: 'm1' }), outcome({ id: 'b', memberId: undefined })]
      }),
      { policyEnforced: true, memberName: (id) => (id === 'm1' ? 'Developer' : undefined) }
    )
    expect(view.steps.map((step) => step.member)).toEqual(['Developer', null])
  })

  it('falls back to the member id rather than dropping who ran the step', () => {
    const view = buildProvenanceView(report({ outcomes: [outcome({ memberId: 'm9' })] }), {
      policyEnforced: true
    })
    expect(view.steps[0]?.member).toBe('m9')
  })

  it('distinguishes a bypass from a rule that is simply off', () => {
    expect(
      buildProvenanceView(report({ reviewBackend: { enforced: true, bypassed: true } }), {
        policyEnforced: true
      }).reviewerRule
    ).toBe('bypassed')
    expect(buildProvenanceView(report(), { policyEnforced: false }).reviewerRule).toBe(
      'not-enforced'
    )
    expect(buildProvenanceView(report(), { policyEnforced: true }).reviewerRule).toBe('enforced')
  })

  it('records an unanswered escalation offer as unanswered, not declined', () => {
    const view = buildProvenanceView(
      report({
        outcomes: [outcome({ escalationOffered: true, escalationAccepted: null })]
      }),
      { policyEnforced: true }
    )
    expect(view.escalation).toEqual({ offered: true, stageKey: 'build', verdict: 'unanswered' })
  })

  it('reports a check ratio only when the check actually filed one', () => {
    const verification = {
      id: 'v1',
      runId: 'run_1',
      taskId: 't1',
      dispatchId: 'd1',
      kind: 'diff_coverage' as const,
      name: 'Diff coverage',
      required: true,
      status: 'passed' as const,
      createdAt: '2026-09-06T00:00:00.000Z'
    }
    const view = buildProvenanceView(
      report({
        verifications: [
          { ...verification, detail: { ratio: 0.86 } },
          { ...verification, id: 'v2', status: 'skipped', detail: {} }
        ]
      }),
      { policyEnforced: true }
    )
    expect(view.checks.map((check) => check.ratio)).toEqual([0.86, null])
  })

  it('truncates a worker report to its first line', () => {
    const view = buildProvenanceView(
      report({ outcomes: [outcome({ reportSummary: `${'x'.repeat(400)}\nsecond line` })] }),
      { policyEnforced: true }
    )
    expect(view.steps[0]?.reportSummary).toHaveLength(200)
    expect(view.steps[0]?.reportSummary).not.toContain('second line')
  })
})

describe('formatSpendCents', () => {
  it('shows an em dash for an unpriced backend rather than a zero', () => {
    expect(formatSpendCents(null)).toBe('—')
    expect(formatSpendCents(undefined)).toBe('—')
    expect(formatSpendCents(0)).toBe('$0.00')
    expect(formatSpendCents(61)).toBe('$0.61')
  })
})

describe('isGateDecisionReason', () => {
  it('accepts GP1 reasons and rejects anything else', () => {
    expect(isGateDecisionReason('blast:reach')).toBe(true)
    expect(isGateDecisionReason('accept-rate')).toBe(true)
    expect(isGateDecisionReason('blast:reachx')).toBe(false)
    expect(isGateDecisionReason('')).toBe(false)
  })
})
