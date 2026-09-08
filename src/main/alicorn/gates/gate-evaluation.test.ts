import { describe, expect, it, vi } from 'vitest'
import { evaluateGateForTask, type GatePolicySource } from './gate-evaluation'
import type { RequiredCheck } from '../../../shared/alicorn/members'
import type { AutonomyPolicy } from '../../../shared/alicorn/gate-policy'
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
    ...overrides
  }
}

function input(overrides: Partial<Parameters<typeof evaluateGateForTask>[1]> = {}) {
  return {
    projectId: 'repo-1',
    stageKey: 'build',
    memberId: 'member-1',
    verifications: [] as DispatchVerificationRow[],
    ...overrides
  }
}

describe('evaluateGateForTask', () => {
  it('gates when the task could not be resolved to a project', async () => {
    await expect(evaluateGateForTask(source(), input({ projectId: null }))).resolves.toEqual({
      decision: 'gate',
      reason: 'unverified'
    })
  })

  it('gates when the control plane cannot be read', async () => {
    const unreachable = source({
      getAutonomyPolicy: vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    })
    await expect(evaluateGateForTask(unreachable, input())).resolves.toEqual({
      decision: 'gate',
      reason: 'unverified'
    })
  })

  it('applies the default policy when the project authored none', async () => {
    // Default is `evidence`, so with no track record the reason is history rather than policy.
    await expect(evaluateGateForTask(source(), input())).resolves.toEqual({
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
      evaluateGateForTask(
        source({ getAutonomyPolicy: vi.fn().mockResolvedValue(authored) }),
        input()
      )
    ).resolves.toEqual({ decision: 'gate', reason: 'policy' })
  })

  it('gates on the authored stage attributes, never on the stage key', async () => {
    const irreversible = source({
      getStageConfig: vi
        .fn()
        .mockResolvedValue({ reversibility: 'irreversible', inheritedCost: 'low' })
    })
    await expect(
      evaluateGateForTask(irreversible, input({ stageKey: 'ship-it' }))
    ).resolves.toEqual({ decision: 'gate', reason: 'irreversible' })
  })

  it('reads the required checks from the project, not from what the member reported', async () => {
    const withChecks = source({ getRequiredChecks: vi.fn().mockResolvedValue([COVERAGE]) })
    // The member ran nothing, so the authored check has no result: unverified, not history.
    await expect(evaluateGateForTask(withChecks, input())).resolves.toEqual({
      decision: 'gate',
      reason: 'unverified'
    })
    await expect(
      evaluateGateForTask(withChecks, input({ verifications: [passingCoverage()] }))
    ).resolves.toEqual({ decision: 'gate', reason: 'history' })
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
