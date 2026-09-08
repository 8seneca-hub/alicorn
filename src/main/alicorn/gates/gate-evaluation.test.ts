import { describe, expect, it, vi } from 'vitest'
import {
  evaluateGateForTask,
  type GateEvaluationInput,
  type GatePolicySource
} from './gate-evaluation'
import type { RequiredCheck } from '../../../shared/alicorn/members'
import type { AutonomyPolicy, TrackRecord } from '../../../shared/alicorn/gate-policy'
import type { DispatchVerificationRow } from '../../runtime/orchestration/db/alicorn/alicorn-rows'

const COVERAGE: RequiredCheck = {
  kind: 'diff_coverage',
  threshold: 0.8,
  lcovPath: 'coverage/lcov.info',
  timeoutMs: 600_000
}

function passingCoverage(): DispatchVerificationRow {
  return {
    dispatchId: 'dispatch-1',
    taskId: 'task-1',
    kind: 'diff_coverage',
    name: 'Diff coverage ≥ 80%',
    required: true,
    status: 'passed',
    detail: null,
    recordedAt: '2026-09-08T12:00:00.000Z'
  }
}

function source(overrides: Partial<GatePolicySource> = {}): GatePolicySource {
  return {
    getStageConfig: vi.fn().mockResolvedValue({ reversibility: 'contained', inheritedCost: 'low' }),
    getAutonomyPolicy: vi.fn().mockResolvedValue(null),
    getRequiredChecks: vi.fn().mockResolvedValue([]),
    getProtectedPaths: vi.fn().mockResolvedValue([]),
    // Absent by default: GP1's suite predates the track record, and a member with none must keep
    // gating on 'history'.
    getTrackRecord: vi.fn().mockRejectedValue(new Error('no track record')),
    ...overrides
  }
}

function input(overrides: Partial<GateEvaluationInput> = {}): GateEvaluationInput {
  return {
    projectId: 'repo-1',
    stageKey: 'build',
    stageKeyAuthored: true,
    memberId: 'member-1',
    verifications: [] as DispatchVerificationRow[],
    blastRadius: { filesChanged: 0, spendCents: 0, changedPaths: [] as string[] },
    ...overrides
  }
}

async function decisionFor(...args: Parameters<typeof evaluateGateForTask>) {
  return (await evaluateGateForTask(...args)).decision
}

function trackRecord(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    memberId: 'member-1',
    stageKey: 'build',
    projectId: 'repo-1',
    runs: 25,
    accepted: 25,
    rejected: 0,
    amended: 0,
    acceptRate: 1,
    recentRegression: false,
    lastAmendedAt: null,
    level: 2,
    amendmentsObserved: true,
    ...overrides
  }
}

describe('evaluateGateForTask', () => {
  it('gates when the task could not be resolved to a project', async () => {
    await expect(decisionFor(source(), input({ projectId: null }))).resolves.toEqual({
      decision: 'gate',
      reason: 'unverified'
    })
  })

  it('gates when the control plane cannot be read', async () => {
    const unreachable = source({
      getAutonomyPolicy: vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    })
    await expect(decisionFor(unreachable, input())).resolves.toEqual({
      decision: 'gate',
      reason: 'unverified'
    })
  })

  it('applies the default policy when the project authored none', async () => {
    // Default is `evidence`, so with no track record the reason is history rather than policy.
    await expect(decisionFor(source(), input())).resolves.toEqual({
      decision: 'gate',
      reason: 'history'
    })
  })

  it('honours an authored always_gate policy', async () => {
    const authored: AutonomyPolicy = {
      projectId: 'repo-1',
      stageKey: 'build',
      memberId: null,
      mode: 'always_gate',
      minRuns: 10,
      minAcceptRate: 0.9,
      maxFiles: null,
      maxSpendCents: null,
      createdBy: 'admin',
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null
    }
    await expect(
      decisionFor(source({ getAutonomyPolicy: vi.fn().mockResolvedValue(authored) }), input())
    ).resolves.toEqual({ decision: 'gate', reason: 'policy' })
  })

  it('gates on the authored stage attributes, never on the stage key', async () => {
    const irreversible = source({
      getStageConfig: vi
        .fn()
        .mockResolvedValue({ reversibility: 'irreversible', inheritedCost: 'low' })
    })
    await expect(decisionFor(irreversible, input({ stageKey: 'ship-it' }))).resolves.toEqual({
      decision: 'gate',
      reason: 'irreversible'
    })
  })

  it('reads the required checks from the project, not from what the member reported', async () => {
    const withChecks = source({ getRequiredChecks: vi.fn().mockResolvedValue([COVERAGE]) })
    // The member ran nothing, so the authored check has no result: unverified, not history.
    await expect(decisionFor(withChecks, input())).resolves.toEqual({
      decision: 'gate',
      reason: 'unverified'
    })
    await expect(
      decisionFor(withChecks, input({ verifications: [passingCoverage()] }))
    ).resolves.toEqual({ decision: 'gate', reason: 'history' })
  })

  it('feeds the track record into the policy and returns the evidence it used', async () => {
    const withRecord = source({ getTrackRecord: vi.fn().mockResolvedValue(trackRecord()) })
    const evaluation = await evaluateGateForTask(withRecord, input())

    expect(evaluation.decision).toEqual({ decision: 'auto', reason: 'auto' })
    expect(evaluation.detail?.evidence.stats).toMatchObject({ runs: 25, acceptRate: 1 })
    expect(evaluation.detail?.policyAuthored).toBe(false)
  })

  it('gates on accept-rate and on regression from the same record', async () => {
    await expect(
      decisionFor(
        source({
          getTrackRecord: vi.fn().mockResolvedValue(trackRecord({ acceptRate: 0.5, accepted: 12 }))
        }),
        input()
      )
    ).resolves.toEqual({ decision: 'gate', reason: 'accept-rate' })
    await expect(
      decisionFor(
        source({
          getTrackRecord: vi.fn().mockResolvedValue(trackRecord({ recentRegression: true }))
        }),
        input()
      )
    ).resolves.toEqual({ decision: 'gate', reason: 'regression' })
  })

  it('gates on history when the ledger is unreachable, not on unverified', async () => {
    const ledgerDown = source({
      getTrackRecord: vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    })
    // A ledger outage is not a policy outage: the reason must say which one happened.
    await expect(decisionFor(ledgerDown, input())).resolves.toEqual({
      decision: 'gate',
      reason: 'history'
    })
  })

  it('does not ask the ledger for a task with no member recorded', async () => {
    const getTrackRecord = vi.fn()
    await expect(
      decisionFor(source({ getTrackRecord }), input({ memberId: null }))
    ).resolves.toEqual({ decision: 'gate', reason: 'history' })
    expect(getTrackRecord).not.toHaveBeenCalled()
  })

  it('never lets a spotless track record retire a hard stop', async () => {
    const spotless = source({
      getTrackRecord: vi.fn().mockResolvedValue(trackRecord({ runs: 500, level: 3 })),
      getStageConfig: vi
        .fn()
        .mockResolvedValue({ reversibility: 'irreversible', inheritedCost: 'high' })
    })
    await expect(decisionFor(spotless, input({ stageKey: 'merge' }))).resolves.toEqual({
      decision: 'gate',
      reason: 'irreversible'
    })
  })

  it('asks for the policy scoped to the project, stage and member', async () => {
    const getAutonomyPolicy = vi.fn().mockResolvedValue(null)
    await evaluateGateForTask(
      source({ getAutonomyPolicy }),
      input({ stageKey: 'review', memberId: 'member-9' })
    )
    expect(getAutonomyPolicy).toHaveBeenCalledWith({
      projectId: 'repo-1',
      stageKey: 'review',
      memberId: 'member-9'
    })
  })
})

// BR1. The budgets themselves are `evaluateGate`'s; what is tested here is that the *evidence*
// reaching them is the run's, is real, and never reads as clean when it could not be measured.
describe('evaluateGateForTask blast radius', () => {
  function spotless(overrides: Partial<GatePolicySource> = {}): GatePolicySource {
    return source({
      getTrackRecord: vi.fn().mockResolvedValue(trackRecord()),
      getRequiredChecks: vi.fn().mockResolvedValue([COVERAGE]),
      ...overrides
    })
  }

  function budget(overrides: Partial<AutonomyPolicy>): GatePolicySource['getAutonomyPolicy'] {
    return vi.fn().mockResolvedValue({
      projectId: 'repo-1',
      stageKey: 'build',
      memberId: 'member-1',
      mode: 'evidence',
      minRuns: 10,
      minAcceptRate: 0.9,
      maxFiles: null,
      maxSpendCents: null,
      createdBy: 'admin',
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      ...overrides
    } satisfies AutonomyPolicy)
  }

  const passing = { verifications: [passingCoverage()] }

  it('gates on the run total, which five small tasks summed past the budget', async () => {
    // Each task changed eight files; no single one breaches a ceiling of ten, the run does.
    const decision = await decisionFor(
      spotless({ getAutonomyPolicy: budget({ maxFiles: 10 }) }),
      input({ ...passing, blastRadius: { filesChanged: 40, spendCents: 0, changedPaths: [] } })
    )
    expect(decision).toEqual({ decision: 'gate', reason: 'blast:files' })
  })

  it('lets a run inside the budget through', async () => {
    const decision = await decisionFor(
      spotless({ getAutonomyPolicy: budget({ maxFiles: 10, maxSpendCents: 500 }) }),
      input({ ...passing, blastRadius: { filesChanged: 9, spendCents: 499, changedPaths: [] } })
    )
    expect(decision).toEqual({ decision: 'auto', reason: 'auto' })
  })

  it('gates on the run spend the same way', async () => {
    const decision = await decisionFor(
      spotless({ getAutonomyPolicy: budget({ maxSpendCents: 500 }) }),
      input({ ...passing, blastRadius: { filesChanged: 1, spendCents: 501, changedPaths: [] } })
    )
    expect(decision).toEqual({ decision: 'gate', reason: 'blast:spend' })
  })

  it('gates when the run could not be measured at all and a budget is authored', async () => {
    const decision = await decisionFor(
      spotless({ getAutonomyPolicy: budget({ maxFiles: 10 }) }),
      input({
        ...passing,
        blastRadius: { filesChanged: null, spendCents: null, changedPaths: null }
      })
    )
    expect(decision).toEqual({ decision: 'gate', reason: 'blast:files' })
  })

  it('gates on reach even with no numeric budget authored — the reach guard is not opt-in', async () => {
    const evaluation = await evaluateGateForTask(
      spotless({
        getProtectedPaths: vi.fn().mockResolvedValue([{ kind: 'path', path: 'infra' }])
      }),
      input({
        ...passing,
        blastRadius: { filesChanged: 2, spendCents: 0, changedPaths: ['src/a.ts', 'infra/main.tf'] }
      })
    )
    expect(evaluation.decision).toEqual({ decision: 'gate', reason: 'blast:reach' })
    expect(evaluation.detail?.evidence.touchedProtectedPath).toBe(true)
    expect(evaluation.detail?.protectedPathMatches).toEqual([
      { path: 'infra/main.tf', rule: { kind: 'path', path: 'infra' } }
    ])
  })

  it('reads an unreadable worktree as unverified, not as reach — a null is not a match', async () => {
    const evaluation = await evaluateGateForTask(
      spotless({
        getProtectedPaths: vi.fn().mockResolvedValue([{ kind: 'extension', extension: '.tf' }])
      }),
      input({
        ...passing,
        blastRadius: { filesChanged: null, spendCents: 0, changedPaths: null }
      })
    )
    expect(evaluation.detail?.evidence.touchedProtectedPath).toBeNull()
    expect(evaluation.decision).toEqual({ decision: 'gate', reason: 'unverified' })
  })

  it('changes nothing for a project that has authored no surface and no budget', async () => {
    // BR1 must be inert until an org admin authors something: an unmeasurable worktree on a
    // project that protects nothing still resolves to false, not to a new gate.
    const evaluation = await evaluateGateForTask(
      spotless(),
      input({
        ...passing,
        blastRadius: { filesChanged: null, spendCents: null, changedPaths: null }
      })
    )
    expect(evaluation.detail?.evidence.touchedProtectedPath).toBe(false)
    expect(evaluation.decision).toEqual({ decision: 'auto', reason: 'auto' })
  })

  it('checks the hard stop before the blast radius, so reach never has to be measured to gate', async () => {
    const decision = await decisionFor(
      spotless({
        getProtectedPaths: vi.fn().mockResolvedValue([{ kind: 'path', path: 'infra' }]),
        getStageConfig: vi
          .fn()
          .mockResolvedValue({ reversibility: 'irreversible', inheritedCost: 'high' })
      }),
      input({
        ...passing,
        stageKey: 'merge',
        blastRadius: { filesChanged: 1, spendCents: 0, changedPaths: ['infra/main.tf'] }
      })
    )
    expect(decision).toEqual({ decision: 'gate', reason: 'irreversible' })
  })

  it('gates when the protected-path surface cannot be read', async () => {
    const decision = await decisionFor(
      spotless({ getProtectedPaths: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }),
      input(passing)
    )
    expect(decision).toEqual({ decision: 'gate', reason: 'unverified' })
  })
})

/**
 * SK1. The assembly's own retirement verdict — the pure ordering is `gate-retirement.test.ts`'s;
 * these are about what the *assembled* evidence resolves to, which is where a real deployment gets
 * its answer. Everything here must refuse, except the one case that has genuinely earned it.
 */
describe('evaluateGateForTask retirement', () => {
  function earned(overrides: Partial<TrackRecord> = {}): GatePolicySource {
    return source({
      getRequiredChecks: vi.fn().mockResolvedValue([COVERAGE]),
      getTrackRecord: vi.fn().mockResolvedValue(
        trackRecord({
          runs: 50,
          accepted: 49,
          amended: 1,
          acceptRate: 0.98,
          level: 3,
          lastAmendedAt: '2026-06-01T00:00:00.000Z',
          ...overrides
        })
      )
    })
  }

  const passing = { verifications: [passingCoverage()] }

  it('retires a gate whose stage has genuinely reached level 3', async () => {
    const evaluation = await evaluateGateForTask(earned(), input(passing))
    expect(evaluation.decision).toEqual({ decision: 'auto', reason: 'auto' })
    expect(evaluation.retirement).toEqual({ retire: true, level: 3 })
  })

  it('does NOT retire a spotless but short record — 49 runs is not 50', async () => {
    const evaluation = await evaluateGateForTask(
      earned({ runs: 49, accepted: 49, amended: 0, acceptRate: 1, level: 2, lastAmendedAt: null }),
      input(passing)
    )
    expect(evaluation.retirement).toEqual({ retire: false, refusal: 'level' })
  })

  it('does NOT retire an irreversible stage on a perfect 500-run record', async () => {
    const evaluation = await evaluateGateForTask(
      source({
        getRequiredChecks: vi.fn().mockResolvedValue([COVERAGE]),
        getTrackRecord: vi
          .fn()
          .mockResolvedValue(trackRecord({ runs: 500, accepted: 500, acceptRate: 1, level: 3 })),
        getStageConfig: vi
          .fn()
          .mockResolvedValue({ reversibility: 'irreversible', inheritedCost: 'low' })
      }),
      input({ ...passing, stageKey: 'merge' })
    )
    expect(evaluation.decision).toEqual({ decision: 'gate', reason: 'irreversible' })
    expect(evaluation.retirement).toEqual({ retire: false, refusal: 'hard-stop:irreversible' })
  })

  it('does NOT retire a free-text stage key, however long its record', async () => {
    const evaluation = await evaluateGateForTask(
      earned({ runs: 500, accepted: 500, acceptRate: 1 }),
      input({ ...passing, stageKey: 'reveiw', stageKeyAuthored: false })
    )
    expect(evaluation.retirement).toEqual({ retire: false, refusal: 'stage-key-unauthored' })
  })

  it('returns the gate on one rejection inside the last ten', async () => {
    const evaluation = await evaluateGateForTask(
      earned({ rejected: 1, recentRegression: true, demotionReason: 'rejection', level: 2 }),
      input(passing)
    )
    expect(evaluation.retirement).toEqual({ retire: false, refusal: 'demoted' })
  })

  it('refuses when the control plane could not be read at all', async () => {
    const evaluation = await evaluateGateForTask(source(), input({ ...passing, projectId: null }))
    expect(evaluation.retirement).toEqual({ retire: false, refusal: 'not-earned' })
  })
})
