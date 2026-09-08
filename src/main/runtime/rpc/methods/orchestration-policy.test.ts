import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { AutonomyPolicy, TrackRecord } from '../../../../shared/alicorn/gate-policy'

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
    createdBy: 'local',
    createdAt: '2026-09-08T00:00:00.000Z',
    expiresAt: null,
    ...overrides
  }
}

function trackRecord(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    memberId: 'member-1',
    stageKey: 'build',
    projectId: 'repo-1',
    runs: 40,
    accepted: 40,
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

function directory(overrides: Partial<MemberDirectory> = {}): MemberDirectory {
  return {
    getMember: vi.fn().mockResolvedValue(null),
    getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: true }),
    getRequiredChecks: vi.fn().mockResolvedValue([]),
    getProtectedPaths: vi.fn().mockResolvedValue([]),
    getAutonomyPolicy: vi.fn().mockResolvedValue(null),
    getStageConfig: vi.fn().mockResolvedValue({ reversibility: 'contained', inheritedCost: 'low' }),
    listAutonomyPolicies: vi.fn().mockResolvedValue([]),
    setAutonomyPolicy: vi.fn().mockImplementation(async (projectId, input) => ({
      ...policy(),
      projectId,
      ...input,
      createdBy: 'authenticated-actor'
    })),
    getTrackRecord: vi.fn().mockRejectedValue(new Error('no track record')),
    ...overrides
  }
}

describe('autonomy policy RPCs', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext

  function setup(source?: MemberDirectory): MemberDirectory {
    ;({ db, runtime, ctx } = h.setup())
    const configured = source ?? directory()
    runtime.setAlicornMemberDirectory(configured)
    return configured
  }

  afterEach(() => {
    h.cleanup()
  })

  async function call(name: string, params: Record<string, unknown>) {
    return h.call(name, params, ctx)
  }

  describe('orchestration.policyGet', () => {
    it('returns the contract default, flagged unauthored, when a project authored nothing', async () => {
      setup()
      const result = (await call('orchestration.policyGet', { project: 'repo-1' })) as {
        policy: AutonomyPolicy
        authored: boolean
        stageConfig: { reversibility: string }
      }

      expect(result.authored).toBe(false)
      expect(result.policy).toMatchObject({ mode: 'evidence', minRuns: 10, minAcceptRate: 0.9 })
      expect(result.stageConfig.reversibility).toBe('contained')
    })

    it('returns the authored policy and the stage attributes that outrank it', async () => {
      const source = directory({
        getAutonomyPolicy: vi.fn().mockResolvedValue(policy({ mode: 'always_gate' })),
        getStageConfig: vi
          .fn()
          .mockResolvedValue({ reversibility: 'irreversible', inheritedCost: 'high' })
      })
      setup(source)

      const result = (await call('orchestration.policyGet', {
        project: 'repo-1',
        stageKey: 'merge',
        member: 'member-1'
      })) as { authored: boolean; stageConfig: { reversibility: string } }

      expect(result.authored).toBe(true)
      expect(result.stageConfig.reversibility).toBe('irreversible')
      expect(source.getAutonomyPolicy).toHaveBeenCalledWith({
        projectId: 'repo-1',
        stageKey: 'merge',
        memberId: 'member-1'
      })
    })

    it('refuses to answer when the control plane is unconfigured', async () => {
      ;({ ctx } = h.setup())
      await expect(call('orchestration.policyGet', { project: 'repo-1' })).rejects.toThrow(
        /control plane is not configured/
      )
    })
  })

  describe('orchestration.policySet', () => {
    it('writes a policy with the defaults the contract states', async () => {
      const source = setup()
      const result = (await call('orchestration.policySet', {
        project: 'repo-1',
        mode: 'evidence'
      })) as { policy: AutonomyPolicy }

      expect(source.setAutonomyPolicy).toHaveBeenCalledWith('repo-1', {
        stageKey: 'build',
        memberId: null,
        mode: 'evidence',
        minRuns: 10,
        minAcceptRate: 0.9,
        maxFiles: null,
        maxSpendCents: null,
        expiresAt: null
      })
      // A member cannot loosen its own criteria: the author is the authenticated actor.
      expect(result.policy.createdBy).toBe('authenticated-actor')
    })

    it('rejects a never_gate exception with no expiry before any write leaves the process', async () => {
      const source = setup()
      await expect(
        call('orchestration.policySet', { project: 'repo-1', mode: 'never_gate' })
      ).rejects.toThrow(/never_gate requires --expires-at/)
      expect(source.setAutonomyPolicy).not.toHaveBeenCalled()
    })

    it('rejects a never_gate exception that is already lapsed', async () => {
      const source = setup()
      await expect(
        call('orchestration.policySet', {
          project: 'repo-1',
          mode: 'never_gate',
          expiresAt: '2020-01-01T00:00:00.000Z'
        })
      ).rejects.toThrow(/never_gate requires --expires-at/)
      expect(source.setAutonomyPolicy).not.toHaveBeenCalled()
    })

    it('accepts a never_gate exception with a future expiry', async () => {
      const source = setup()
      const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
      await call('orchestration.policySet', {
        project: 'repo-1',
        mode: 'never_gate',
        expiresAt
      })
      expect(source.setAutonomyPolicy).toHaveBeenCalledWith(
        'repo-1',
        expect.objectContaining({ mode: 'never_gate', expiresAt })
      )
    })

    it('rejects an out-of-range accept rate rather than sending it to the control plane', async () => {
      const source = setup()
      await expect(
        call('orchestration.policySet', { project: 'repo-1', mode: 'evidence', minAcceptRate: 1.5 })
      ).rejects.toThrow(/Invalid policy/)
      expect(source.setAutonomyPolicy).not.toHaveBeenCalled()
    })

    it('replaces rather than patches: an omitted budget clears it', async () => {
      const source = setup()
      await call('orchestration.policySet', {
        project: 'repo-1',
        mode: 'evidence',
        maxFiles: 20
      })
      await call('orchestration.policySet', { project: 'repo-1', mode: 'evidence' })
      expect(source.setAutonomyPolicy).toHaveBeenLastCalledWith(
        'repo-1',
        expect.objectContaining({ maxFiles: null })
      )
    })

    it('refuses an unknown mode at the wire boundary', async () => {
      setup()
      await expect(
        call('orchestration.policySet', { project: 'repo-1', mode: 'sometimes' })
      ).rejects.toThrow()
    })
  })

  describe('orchestration.policyList', () => {
    it('lists lapsed exceptions alongside standing ones and counts only the live', async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString()
      setup(
        directory({
          listAutonomyPolicies: vi
            .fn()
            .mockResolvedValue([
              policy(),
              policy({ stageKey: 'review', mode: 'never_gate', expiresAt: future }),
              policy({
                stageKey: 'test',
                mode: 'never_gate',
                expiresAt: '2020-01-01T00:00:00.000Z'
              })
            ])
        })
      )

      const result = (await call('orchestration.policyList', { project: 'repo-1' })) as {
        policies: AutonomyPolicy[]
        exceptions: { stageKey: string; lapsed: boolean }[]
        standingExceptions: number
      }

      expect(result.policies).toHaveLength(3)
      expect(result.exceptions).toEqual([
        expect.objectContaining({ stageKey: 'review', lapsed: false }),
        expect.objectContaining({ stageKey: 'test', lapsed: true })
      ])
      expect(result.standingExceptions).toBe(1)
    })
  })

  describe('orchestration.evidence', () => {
    function dispatchedTask(): string {
      const task = db.createTask({ spec: 'ship it' })
      const dispatch = db.createDispatchContext({
        taskId: task.id,
        assigneeHandle: 'term_worker',
        creator: { kind: 'system' },
        maxDepth: 3
      })
      db.db
        .prepare(
          `INSERT INTO worker_dispatches (dispatch_id, state, worktree_id) VALUES (?, 'succeeded', ?)`
        )
        .run(dispatch.id, 'worktree-1')
      db.setDispatchMember({
        dispatchId: dispatch.id,
        memberId: 'member-1',
        memberRole: 'implementer',
        backend: 'claude',
        reviewBackendBypass: false
      })
      vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({
        id: 'worktree-1',
        repoId: 'repo-1'
      } as Awaited<ReturnType<OrcaRuntimeService['showManagedWorktree']>>)
      return task.id
    }

    it('reports the track record and what the policy would decide now', async () => {
      setup(directory({ getTrackRecord: vi.fn().mockResolvedValue(trackRecord()) }))
      const taskId = dispatchedTask()

      const result = (await call('orchestration.evidence', { task: taskId })) as {
        memberId: string | null
        trackRecord: TrackRecord
        policyAuthored: boolean
        wouldDecide: { decision: string; reason: string }
      }

      expect(result.memberId).toBe('member-1')
      expect(result.trackRecord.runs).toBe(40)
      expect(result.policyAuthored).toBe(false)
      // Nothing is required and the track record clears the default thresholds, so the policy
      // would not ask. Reading that here resolves nothing — gateCreate is the only actor.
      expect(result.wouldDecide).toEqual({ decision: 'auto', reason: 'auto' })
    })

    it('gates on history when the ledger has no record for the member', async () => {
      setup()
      const taskId = dispatchedTask()

      const result = (await call('orchestration.evidence', { task: taskId })) as {
        trackRecord: TrackRecord | null
        wouldDecide: { reason: string }
      }

      expect(result.trackRecord).toBeNull()
      expect(result.wouldDecide.reason).toBe('history')
    })

    it('never lets a track record retire a hard stop', async () => {
      setup(
        directory({
          getTrackRecord: vi.fn().mockResolvedValue(trackRecord({ runs: 500, level: 3 })),
          getStageConfig: vi
            .fn()
            .mockResolvedValue({ reversibility: 'irreversible', inheritedCost: 'high' })
        })
      )
      const taskId = dispatchedTask()

      const result = (await call('orchestration.evidence', {
        task: taskId,
        stageKey: 'merge'
      })) as { wouldDecide: { decision: string; reason: string } }

      expect(result.wouldDecide).toEqual({ decision: 'gate', reason: 'irreversible' })
    })

    it('rejects a task the client does not know about', async () => {
      setup()
      await expect(call('orchestration.evidence', { task: 'task_missing' })).rejects.toThrow(
        /Task not found/
      )
    })
  })
})
