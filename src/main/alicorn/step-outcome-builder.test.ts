import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { createRootDispatch } from '../runtime/orchestration/db/root-dispatch-test-fixture'
import { buildStepOutcomeInput } from './step-outcome-builder'

describe('buildStepOutcomeInput', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  it('builds from a dispatch member, an orchestrated strategy, and a worktree', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    db.setDispatchMember({
      dispatchId: dispatch.id,
      memberId: 'm1',
      memberRole: 'reviewer',
      backend: 'codex',
      reviewBackendBypass: true
    })
    db.setTaskExecutionStrategy(task.id, 'orchestrated', 'user')
    const result = JSON.stringify({ phase: 'review', body: 'Looks good.', filesModified: ['a.ts'] })
    const settlement = db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result
    })
    expect(settlement.action).toBe('settled')

    const input = buildStepOutcomeInput({
      db,
      payload: { taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded', result },
      worktree: {
        id: 'wt_1',
        path: '/tmp/wt',
        branch: 'feature',
        repoId: 'repo_1'
      }
    })

    const dispatchRow = db.getDispatchContextById(dispatch.id)
    expect(input).toEqual({
      runId: task.run_id,
      taskId: task.id,
      dispatchId: dispatch.id,
      projectId: 'repo_1',
      repoId: 'repo_1',
      worktreeId: 'wt_1',
      branch: 'feature',
      memberId: 'm1',
      backend: 'codex',
      stageKey: 'review',
      executionStrategy: 'orchestrated',
      outcome: 'succeeded',
      filesModified: ['a.ts'],
      reportSummary: 'Looks good.',
      reviewBackendBypass: true,
      escalationOffered: false,
      escalationAccepted: null,
      clientTs: `${dispatchRow!.completed_at!.replace(' ', 'T')}Z`
    })
  })

  it('falls back to the worker start_options agent when no dispatch member is set', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { agent: 'claude' },
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })

    const input = buildStepOutcomeInput({
      db,
      payload: {
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: JSON.stringify({ filesModified: [] })
      },
      worktree: null
    })

    expect(input.backend).toBe('claude')
    expect(input.memberId).toBeUndefined()
    expect(input.stageKey).toBe('build')
    expect(input.reviewBackendBypass).toBe(false)
  })

  it('maps claude-agent-teams start_options to the claude backend', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { agent: 'claude-agent-teams' },
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })

    const input = buildStepOutcomeInput({
      db,
      payload: {
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: JSON.stringify({})
      },
      worktree: null
    })

    expect(input.backend).toBe('claude')
  })

  it('trims an empty phase down to the build default stageKey', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')

    const input = buildStepOutcomeInput({
      db,
      payload: {
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: JSON.stringify({ phase: '' })
      },
      worktree: null
    })

    expect(input.stageKey).toBe('build')
  })

  it('caps an oversized phase at 64 characters', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    const phase = 'x'.repeat(80)

    const input = buildStepOutcomeInput({
      db,
      payload: {
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: JSON.stringify({ phase })
      },
      worktree: null
    })

    expect(input.stageKey).toBe('x'.repeat(64))
  })

  it('defaults to other backend for an agent Alicorn does not price', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { agent: 'gemini' },
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })

    const input = buildStepOutcomeInput({
      db,
      payload: {
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: JSON.stringify({})
      },
      worktree: null
    })

    expect(input.backend).toBe('other')
  })

  it('defaults to other backend when start_options has no recognizable agent', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')

    const input = buildStepOutcomeInput({
      db,
      payload: {
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'failed',
        result: JSON.stringify({})
      },
      worktree: null
    })

    expect(input.backend).toBe('other')
    expect(input.outcome).toBe('failed')
    expect(input.clientTs).toBeUndefined()
  })

  it('throws when the task no longer exists, so the drainer can mark the row failed', () => {
    db = new OrchestrationDb(':memory:')

    expect(() =>
      buildStepOutcomeInput({
        db,
        payload: {
          taskId: 'missing-task',
          dispatchId: 'missing-dispatch',
          outcome: 'succeeded',
          result: '{}'
        },
        worktree: null
      })
    ).toThrow(/unknown task/)
  })

  it('derives escalationOffered/escalationAccepted from the task execution strategy', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    db.markEscalationOffered(task.id)

    const offeredOnly = buildStepOutcomeInput({
      db,
      payload: { taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded', result: '{}' },
      worktree: null
    })
    expect(offeredOnly.escalationOffered).toBe(true)
    expect(offeredOnly.escalationAccepted).toBe(false)

    db.setTaskExecutionStrategy(task.id, 'orchestrated', 'escalation')
    const accepted = buildStepOutcomeInput({
      db,
      payload: { taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded', result: '{}' },
      worktree: null
    })
    expect(accepted.escalationOffered).toBe(true)
    expect(accepted.escalationAccepted).toBe(true)
  })

  // Why these: `member_stage_stats` is keyed on (member_id, stage_key) and the autonomy policy
  // reads it, so a board dispatch landing under 'build' mixes reviewer track record into
  // implementation work.
  describe('stageKey for a board dispatch', () => {
    function settledBoardDispatch(options: { phase?: string; toStatusId?: string }) {
      db = new OrchestrationDb(':memory:')
      const task = db.createTask({ spec: 'work' })
      const dispatch = createRootDispatch(db, task.id, 'term_worker')
      if (options.toStatusId) {
        db.recordBoardTransition({
          repoId: 'repo_1',
          worktreeId: 'wt_1',
          taskId: task.id,
          dispatchId: dispatch.id,
          toStatusId: options.toStatusId,
          ruleId: 'rule_1',
          outcome: 'dispatched'
        })
      }
      const result = JSON.stringify({
        ...(options.phase ? { phase: options.phase } : {}),
        body: 'done'
      })
      db.settleWorkerReport({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result
      })
      return buildStepOutcomeInput({
        db,
        payload: { taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded', result },
        worktree: { id: 'wt_1', path: '/tmp/wt', branch: 'feature', repoId: 'repo_1' }
      })
    }

    it('records the column that dispatched the work', () => {
      expect(settledBoardDispatch({ toStatusId: 'in-review' }).stageKey).toBe('in-review')
    })

    // The stage a member is judged on is authored config, never chosen by the member itself.
    it('lets the column win over the phase the worker reported', () => {
      expect(settledBoardDispatch({ toStatusId: 'in-review', phase: 'build' }).stageKey).toBe(
        'in-review'
      )
    })

    it('still uses the reported phase when no board transition dispatched it', () => {
      expect(settledBoardDispatch({ phase: 'review' }).stageKey).toBe('review')
    })

    it('falls back to build when neither names a stage', () => {
      expect(settledBoardDispatch({}).stageKey).toBe('build')
    })

    // A refusal carries no dispatch id, so it must never be resolved onto another dispatch.
    it('ignores a refusal recorded for the same worktree', () => {
      db = new OrchestrationDb(':memory:')
      const task = db.createTask({ spec: 'work' })
      const dispatch = createRootDispatch(db, task.id, 'term_worker')
      db.recordBoardTransition({
        repoId: 'repo_1',
        worktreeId: 'wt_1',
        toStatusId: 'in-review',
        ruleId: 'rule_1',
        outcome: 'refused_ceiling'
      })
      const result = JSON.stringify({ body: 'done' })
      db.settleWorkerReport({
        taskId: task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result
      })
      const input = buildStepOutcomeInput({
        db,
        payload: { taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded', result },
        worktree: { id: 'wt_1', path: '/tmp/wt', branch: 'feature', repoId: 'repo_1' }
      })
      expect(input.stageKey).toBe('build')
    })

    it('truncates an oversized column id to the 64-char ledger limit', () => {
      expect(settledBoardDispatch({ toStatusId: 'x'.repeat(80) }).stageKey).toBe('x'.repeat(64))
    })
  })
})
