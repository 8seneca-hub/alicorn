import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { MemberDirectory } from '../../../alicorn/member-directory'
import type { DecisionGateRow } from '../../orchestration/types'
import type { DispatchVerificationRow } from '../../orchestration/db/alicorn/alicorn-rows'

function directory(overrides: Partial<MemberDirectory> = {}): MemberDirectory {
  return {
    getMember: vi.fn().mockResolvedValue(null),
    listMembers: vi.fn().mockResolvedValue([]),
    getOrgPolicy: vi.fn().mockResolvedValue({ enforceDistinctReviewerBackend: true }),
    getRequiredChecks: vi.fn().mockResolvedValue([]),
    getProtectedPaths: vi.fn().mockResolvedValue([]),
    getAutonomyPolicy: vi.fn().mockResolvedValue(null),
    getStageConfig: vi.fn().mockResolvedValue({ reversibility: 'contained', inheritedCost: 'low' }),
    listAutonomyPolicies: vi.fn().mockResolvedValue([]),
    setAutonomyPolicy: vi.fn(),
    getTrackRecord: vi.fn().mockRejectedValue(new Error('no track record')),
    ...overrides
  }
}

describe('gate policy RPCs', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext

  function setup(): void {
    ;({ db, runtime, ctx } = h.setup())
  }

  afterEach(() => {
    h.cleanup()
  })

  async function call(name: string, params: Record<string, unknown>) {
    return h.call(name, params, ctx)
  }

  function dispatchedTask(worktreeId = 'worktree-1'): { taskId: string; dispatchId: string } {
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
      .run(dispatch.id, worktreeId)
    // Why the member stamp: the gate's track record is keyed by member, so a memberless dispatch
    // has no level to record — `readTrackRecord` returns null before it ever asks the directory.
    db.setDispatchMember({
      dispatchId: dispatch.id,
      memberId: 'm1',
      memberRole: 'implementer',
      backend: 'claude',
      reviewBackendBypass: false
    })
    vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({
      id: worktreeId,
      repoId: 'repo-1'
    } as Awaited<ReturnType<OrcaRuntimeService['showManagedWorktree']>>)
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  describe('orchestration.gateResolve agreement (GP3)', () => {
    async function evaluatedGate(level: number): Promise<string> {
      setup()
      runtime.setAlicornMemberDirectory(
        directory({
          getTrackRecord: vi.fn().mockResolvedValue({
            memberId: 'm1',
            stageKey: 'build',
            projectId: 'repo-1',
            runs: 12,
            accepted: 12,
            rejected: 0,
            amended: 0,
            acceptRate: 1,
            recentRegression: false,
            lastAmendedAt: null,
            level,
            amendmentsObserved: false
          })
        })
      )
      const { taskId } = dispatchedTask()
      const created = (await call('orchestration.gateCreate', {
        task: taskId,
        question: 'Proceed?',
        evaluate: true
      })) as { gate: DecisionGateRow }
      return created.gate.id
    }

    it('records the level the member was at when the gate opened', async () => {
      const gateId = await evaluatedGate(1)
      expect(db.getGate(gateId)?.recommended_level).toBe(1)
    })

    it('enqueues the agreement when the resolver states its own gate verdict', async () => {
      const gateId = await evaluatedGate(1)

      const result = (await call('orchestration.gateResolve', {
        id: gateId,
        resolution: 'go ahead',
        humanGateDecision: 'auto',
        recommendationShown: true
      })) as { agreementRecorded: boolean }

      expect(result.agreementRecorded).toBe(true)
      const row = db.listDueLedgerOutbox(25).find((r) => r.kind === 'gate_agreement_patch')!
      expect(JSON.parse(row.payload)).toMatchObject({
        gateId,
        humanGateDecision: 'auto',
        recommendationShown: true
      })
    })

    it('records nothing when the resolver says nothing about the gate', async () => {
      const gateId = await evaluatedGate(1)

      const result = (await call('orchestration.gateResolve', {
        id: gateId,
        resolution: 'go ahead'
      })) as { agreementRecorded: boolean }

      expect(result.agreementRecorded).toBe(false)
      expect(db.listDueLedgerOutbox(25).some((r) => r.kind === 'gate_agreement_patch')).toBe(false)
    })

    it('treats an unstated recommendationShown as not shown, never as shown', async () => {
      const gateId = await evaluatedGate(1)

      await call('orchestration.gateResolve', {
        id: gateId,
        resolution: 'go ahead',
        humanGateDecision: 'gate'
      })

      const row = db.listDueLedgerOutbox(25).find((r) => r.kind === 'gate_agreement_patch')!
      expect(JSON.parse(row.payload).recommendationShown).toBe(false)
    })
  })

  describe('orchestration.gateCreate { evaluate }', () => {
    it('leaves the gate untouched when evaluate is absent', async () => {
      setup()
      const task = db.createTask({ spec: 'needs approval' })
      const result = (await call('orchestration.gateCreate', {
        task: task.id,
        question: 'Proceed?'
      })) as { gate: DecisionGateRow; recommendation?: unknown }

      expect(result.recommendation).toBeUndefined()
      expect(result.gate.recommended_decision).toBeNull()
      expect(result.gate.recommended_reason).toBeNull()
    })

    it('records the decision it would have made and still gates', async () => {
      setup()
      runtime.setAlicornMemberDirectory(directory())
      const { taskId } = dispatchedTask()

      const result = (await call('orchestration.gateCreate', {
        task: taskId,
        question: 'Proceed?',
        evaluate: true
      })) as { gate: DecisionGateRow; recommendation: { decision: string; reason: string } }

      // No track record exists yet, so the default `evidence` policy recommends a gate on history.
      expect(result.recommendation).toEqual({ decision: 'gate', reason: 'history' })
      expect(result.gate.status).toBe('pending')
      expect(result.gate.recommended_decision).toBe('gate')
      expect(result.gate.recommended_reason).toBe('history')
      expect(db.getTask(taskId)?.status).toBe('blocked')
    })

    it('never auto-resolves, even when the policy would allow it', async () => {
      setup()
      const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
      runtime.setAlicornMemberDirectory(
        directory({
          getAutonomyPolicy: vi.fn().mockResolvedValue({
            projectId: 'repo-1',
            stageKey: 'build',
            memberId: null,
            mode: 'never_gate',
            minRuns: 10,
            minAcceptRate: 0.9,
            maxFiles: null,
            maxSpendCents: null,
            createdBy: 'admin',
            createdAt: '2026-09-01T00:00:00.000Z',
            expiresAt
          })
        })
      )
      const { taskId } = dispatchedTask()

      const result = (await call('orchestration.gateCreate', {
        task: taskId,
        question: 'Proceed?',
        evaluate: true
      })) as { gate: DecisionGateRow; recommendation: { decision: string; reason: string } }

      expect(result.recommendation).toEqual({ decision: 'auto', reason: 'never_gate' })
      // Level 0/1 is the ceiling: the recommendation is recorded, the gate still blocks.
      expect(result.gate.status).toBe('pending')
      expect(result.gate.resolution).toBeNull()
      expect(db.getTask(taskId)?.status).toBe('blocked')
    })

    it('gates as unverified when the control plane is unconfigured', async () => {
      setup()
      runtime.setAlicornMemberDirectory(null)
      const { taskId } = dispatchedTask()

      const result = (await call('orchestration.gateCreate', {
        task: taskId,
        question: 'Proceed?',
        evaluate: true
      })) as { recommendation: { decision: string; reason: string } }

      expect(result.recommendation).toEqual({ decision: 'gate', reason: 'unverified' })
    })

    it('evaluates the stage the caller names, on that stage authored attributes', async () => {
      setup()
      const getStageConfig = vi
        .fn()
        .mockResolvedValue({ reversibility: 'irreversible', inheritedCost: 'high' })
      runtime.setAlicornMemberDirectory(directory({ getStageConfig }))
      const { taskId } = dispatchedTask()

      const result = (await call('orchestration.gateCreate', {
        task: taskId,
        question: 'Merge?',
        evaluate: true,
        stageKey: 'merge'
      })) as { recommendation: { decision: string; reason: string } }

      expect(getStageConfig).toHaveBeenCalledWith('repo-1', 'merge')
      expect(result.recommendation).toEqual({ decision: 'gate', reason: 'irreversible' })
    })

    it('sees a check recorded through verifyRecord', async () => {
      setup()
      const coverage = {
        kind: 'diff_coverage',
        threshold: 0.8,
        lcovPath: 'coverage/lcov.info',
        timeoutMs: 600_000
      }
      runtime.setAlicornMemberDirectory(
        directory({ getRequiredChecks: vi.fn().mockResolvedValue([coverage]) })
      )
      const { taskId } = dispatchedTask()

      const unverified = (await call('orchestration.gateCreate', {
        task: taskId,
        question: 'Proceed?',
        evaluate: true
      })) as { recommendation: { reason: string } }
      expect(unverified.recommendation.reason).toBe('unverified')

      const second = dispatchedTask()
      await call('orchestration.verifyRecord', {
        task: second.taskId,
        kind: 'diff_coverage',
        name: 'Diff coverage ≥ 80%',
        status: 'passed',
        from: 'term_coord'
      })
      const verified = (await call('orchestration.gateCreate', {
        task: second.taskId,
        question: 'Proceed?',
        evaluate: true
      })) as { recommendation: { reason: string } }
      // The check now passes, so the policy moves on to the next reason in the order.
      expect(verified.recommendation.reason).toBe('history')
    })
  })

  /**
   * SK1 level 3. The one place a gate stops interrupting — so these assert both halves: that a
   * stage which has genuinely earned it stops blocking, and that nothing short of that does.
   */
  describe('orchestration.gateCreate retirement (SK1)', () => {
    /** A window that has genuinely reached level 3: 50 runs, 0.98 accepted, corrected once. */
    function earnedTrackRecord(overrides: Record<string, unknown> = {}) {
      return {
        memberId: 'm1',
        stageKey: 'build',
        projectId: 'repo-1',
        runs: 50,
        accepted: 49,
        rejected: 0,
        amended: 1,
        acceptRate: 0.98,
        recentRegression: false,
        lastAmendedAt: '2026-06-01T00:00:00.000Z',
        level: 3,
        amendmentsObserved: true,
        demotionReason: null,
        ...overrides
      }
    }

    async function createEvaluatedGate(
      trackRecord: Record<string, unknown> | null,
      params: Record<string, unknown> = {},
      overrides: Partial<MemberDirectory> = {}
    ) {
      setup()
      runtime.setAlicornMemberDirectory(
        directory({
          getTrackRecord:
            trackRecord === null
              ? vi.fn().mockRejectedValue(new Error('no track record'))
              : vi.fn().mockResolvedValue(trackRecord),
          ...overrides
        })
      )
      const { taskId } = dispatchedTask()
      const result = (await call('orchestration.gateCreate', {
        task: taskId,
        question: 'Proceed?',
        evaluate: true,
        ...params
      })) as {
        gate: DecisionGateRow
        recommendation: { decision: string; reason: string }
        retired: boolean
        retirement: { retire: boolean; refusal?: string }
      }
      return { ...result, taskId }
    }

    it('retires the gate and lets the task carry on', async () => {
      const result = await createEvaluatedGate(earnedTrackRecord())

      expect(result.recommendation).toEqual({ decision: 'auto', reason: 'auto' })
      expect(result.retired).toBe(true)
      expect(result.gate.status).toBe('resolved')
      expect(result.gate.resolution).toBe('auto:auto')
      expect(result.gate.retired_at).not.toBeNull()
      expect(result.gate.retirement_refusal).toBeNull()
      // "Notifies instead of blocking": the record is kept, the task is not held.
      expect(db.getTask(result.taskId)?.status).toBe('ready')
    })

    it('records the canonical stage key it was judged under, not the caller free text', async () => {
      const result = await createEvaluatedGate(earnedTrackRecord(), { stageKey: 'In Progress' })
      expect(result.gate.stage_key).toBe('build')
    })

    it('does NOT retire a spotless but short record, and says why', async () => {
      const result = await createEvaluatedGate(
        earnedTrackRecord({ runs: 49, accepted: 49, amended: 0, acceptRate: 1, level: 2 })
      )

      expect(result.retired).toBe(false)
      expect(result.gate.status).toBe('pending')
      expect(result.gate.retired_at).toBeNull()
      expect(result.gate.retirement_refusal).toBe('level')
      expect(db.getTask(result.taskId)?.status).toBe('blocked')
    })

    it('does NOT retire an irreversible stage on a perfect 500-run record', async () => {
      const result = await createEvaluatedGate(
        earnedTrackRecord({ runs: 500, accepted: 500, amended: 0, acceptRate: 1 }),
        { stageKey: 'merge' },
        {
          getStageConfig: vi
            .fn()
            .mockResolvedValue({ reversibility: 'irreversible', inheritedCost: 'low' })
        }
      )

      expect(result.retired).toBe(false)
      expect(result.gate.status).toBe('pending')
      expect(result.gate.retirement_refusal).toBe('hard-stop:irreversible')
      expect(db.getTask(result.taskId)?.status).toBe('blocked')
    })

    it('returns the gate on one rejection inside the last ten', async () => {
      const result = await createEvaluatedGate(
        earnedTrackRecord({
          rejected: 1,
          recentRegression: true,
          demotionReason: 'rejection',
          level: 2
        })
      )

      expect(result.retired).toBe(false)
      expect(result.gate.retirement_refusal).toBe('demoted')
      expect(db.getTask(result.taskId)?.status).toBe('blocked')
    })

    it('does NOT retire when there is no track record at all', async () => {
      const result = await createEvaluatedGate(null)
      expect(result.retired).toBe(false)
      expect(result.gate.retirement_refusal).toBe('not-earned')
    })

    // The north-star metric is interruptions per completed task; a gate nobody was asked about
    // must not be counted as one.
    it('does not count a retired gate as a ledger interruption', async () => {
      const result = await createEvaluatedGate(earnedTrackRecord())
      const blocking = db.createGate({ taskId: result.taskId, question: 'and this one?' })
      db.resolveGate(blocking.id, 'yes')

      const dispatch = db.createDispatchContext({
        taskId: result.taskId,
        assigneeHandle: 'term_worker_2',
        creator: { kind: 'system' },
        maxDepth: 3
      })
      db.settleWorkerReport({
        taskId: result.taskId,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: 'done'
      })

      const gateInterruptions = db
        .listDueLedgerOutbox(50)
        .map((row) => JSON.parse(row.payload) as { kind?: string; sourceId?: string })
        .filter((payload) => payload.kind === 'gate')
      expect(gateInterruptions.map((payload) => payload.sourceId)).toEqual([blocking.id])
    })
  })

  describe('orchestration.verifyRecord', () => {
    it('records a named result against the task latest dispatch', async () => {
      setup()
      const { taskId, dispatchId } = dispatchedTask()

      const result = (await call('orchestration.verifyRecord', {
        task: taskId,
        name: 'Typecheck',
        status: 'passed',
        from: 'term_coord'
      })) as { dispatchId: string; verifications: DispatchVerificationRow[] }

      expect(result.dispatchId).toBe(dispatchId)
      expect(result.verifications).toHaveLength(1)
      expect(result.verifications[0]).toMatchObject({
        kind: 'manual',
        name: 'Typecheck',
        required: true,
        status: 'passed'
      })
    })

    it('replaces an earlier result for the same check rather than appending', async () => {
      setup()
      const { taskId } = dispatchedTask()
      await call('orchestration.verifyRecord', {
        task: taskId,
        name: 'Typecheck',
        status: 'failed',
        from: 'term_coord'
      })
      const result = (await call('orchestration.verifyRecord', {
        task: taskId,
        name: 'Typecheck',
        status: 'passed',
        from: 'term_coord'
      })) as { verifications: DispatchVerificationRow[] }

      expect(result.verifications).toHaveLength(1)
      expect(result.verifications[0].status).toBe('passed')
    })

    it('stores an optional detail object and rejects anything else', async () => {
      setup()
      const { taskId } = dispatchedTask()
      const result = (await call('orchestration.verifyRecord', {
        task: taskId,
        name: 'Coverage',
        status: 'failed',
        detail: JSON.stringify({ covered: 0.4 }),
        from: 'term_coord'
      })) as { verifications: DispatchVerificationRow[] }
      expect(result.verifications[0].detail).toBe('{"covered":0.4}')

      await expect(
        call('orchestration.verifyRecord', {
          task: taskId,
          name: 'Coverage',
          status: 'failed',
          detail: '[1,2]',
          from: 'term_coord'
        })
      ).rejects.toThrow('Invalid --detail')
    })

    it('rejects an unknown task', async () => {
      setup()
      await expect(
        call('orchestration.verifyRecord', {
          task: 'task_missing',
          name: 'Typecheck',
          status: 'passed',
          from: 'term_coord'
        })
      ).rejects.toThrow('Task not found')
    })

    it('rejects a task that never dispatched', async () => {
      setup()
      const task = db.createTask({ spec: 'nothing ran' })
      await expect(
        call('orchestration.verifyRecord', {
          task: task.id,
          name: 'Typecheck',
          status: 'passed',
          from: 'term_coord'
        })
      ).rejects.toThrow('no dispatch')
    })
  })
})
