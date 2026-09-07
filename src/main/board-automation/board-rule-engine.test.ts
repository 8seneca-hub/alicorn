import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardAutomationRule } from '../../shared/global-settings-types'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { createBoardRuleEngine } from './board-rule-engine'
import { createBoardRuleStore } from './board-rule-store'
import { BOARD_DISPATCH_CEILING } from './board-guard-rails'

const createTaskInRun = vi.hoisted(() => vi.fn())
const startWorkerForTask = vi.hoisted(() => vi.fn())

vi.mock('../runtime/rpc/methods/orchestration-task-internal', () => ({ createTaskInRun }))
vi.mock('../runtime/rpc/methods/orchestration-worker-internal', () => ({ startWorkerForTask }))

const RULE: BoardAutomationRule = {
  id: 'rule-1',
  repoId: 'repo-1',
  toStatusId: 'in-review',
  memberId: 'member-reviewer',
  promptTemplate: 'Review {{worktree}} for {{issue}}',
  enabled: true
}

const EVENT = {
  worktreeId: 'wt-1',
  repoId: 'repo-1',
  fromStatusId: 'in-progress',
  toStatusId: 'in-review',
  worktreePath: '/tmp/wt-1',
  issueRef: 'ALC-49',
  workspaceName: 'alc-49-board'
}

describe('board rule engine', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    createTaskInRun.mockReset()
    startWorkerForTask.mockReset()
    createTaskInRun.mockImplementation(() => ({ id: 'task-1', spec: 'x' }))
    startWorkerForTask.mockResolvedValue({ dispatchId: 'ctx-1', state: 'ready' })
  })

  afterEach(() => {
    db.close()
  })

  function engine(rules: BoardAutomationRule[] = [RULE]) {
    return createBoardRuleEngine({
      runtime: {} as never,
      getDb: () => db,
      rules: createBoardRuleStore(() => ({ boardAutomation: { rules } }) as never)
    })
  }

  it('dispatches the bound member and records the transition', async () => {
    const result = await engine().onWorkspaceStatusChanged(EVENT)

    expect(result).toEqual({ allow: true, dispatchId: 'ctx-1' })
    expect(startWorkerForTask).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          task: 'task-1',
          worktree: 'id:wt-1',
          member: 'member-reviewer',
          from: 'board:repo-1'
        })
      })
    )
    const [recorded] = db.listBoardTransitions('wt-1', 0)
    expect(recorded).toMatchObject({ outcome: 'dispatched', dispatchId: 'ctx-1', taskId: 'task-1' })
  })

  // Why single: automation dispatches one member for one column; orchestrated is a human choice.
  it('creates the task as single with the template rendered', async () => {
    await engine().onWorkspaceStatusChanged(EVENT)

    expect(createTaskInRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ coordinator_handle: 'board:repo-1' }),
      expect.objectContaining({
        executionStrategy: 'single',
        spec: 'Review alc-49-board for ALC-49'
      })
    )
  })

  // Why not a refusal: a column with no rule is the ordinary case. Recording it would fill the
  // history with noise and make the kill-switch UI read as if automation kept refusing work.
  it('skips a column with no rule without recording anything', async () => {
    const result = await engine([]).onWorkspaceStatusChanged(EVENT)

    expect(result).toMatchObject({ allow: false, reason: 'skipped' })
    expect(db.listBoardTransitions('wt-1', 0)).toEqual([])
    expect(startWorkerForTask).not.toHaveBeenCalled()
  })

  it('skips a disabled rule', async () => {
    const result = await engine([{ ...RULE, enabled: false }]).onWorkspaceStatusChanged(EVENT)
    expect(result).toMatchObject({ allow: false, reason: 'skipped' })
  })

  it('refuses and records when the board is killed', async () => {
    db.setBoardAutomationDisabled('board:repo-1', 'nghia')

    const result = await engine().onWorkspaceStatusChanged(EVENT)

    expect(result).toMatchObject({ allow: false, reason: 'killed' })
    expect(startWorkerForTask).not.toHaveBeenCalled()
    expect(db.listBoardTransitions('wt-1', 0)[0]).toMatchObject({
      outcome: 'refused_killed'
    })
  })

  it('refuses when automation is killed globally', async () => {
    db.setBoardAutomationDisabled('global', 'nghia')
    const result = await engine().onWorkspaceStatusChanged(EVENT)
    expect(result).toMatchObject({ allow: false, reason: 'killed' })
  })

  it('refuses and records at the dispatch ceiling', async () => {
    for (let i = 0; i < BOARD_DISPATCH_CEILING.max; i++) {
      db.recordBoardTransition({
        repoId: 'repo-1',
        worktreeId: 'wt-1',
        toStatusId: `col-${i}`,
        ruleId: 'rule-1',
        outcome: 'dispatched'
      })
    }

    const result = await engine().onWorkspaceStatusChanged(EVENT)

    expect(result).toMatchObject({ allow: false, reason: 'ceiling' })
    expect(startWorkerForTask).not.toHaveBeenCalled()
    const outcomes = db.listBoardTransitions('wt-1', 0).map((r) => r.outcome)
    expect(outcomes).toContain('refused_ceiling')
  })

  // Why: a failed start returns its receipt with the dispatch id still on it, so keying success on
  // the id alone would record every failure as a dispatch.
  it('records a failed start as a refusal rather than a dispatch', async () => {
    startWorkerForTask.mockResolvedValue({
      dispatchId: 'ctx-1',
      failedStage: 'agent_readiness',
      lastError: 'Agent did not become ready (timeout).'
    })

    const result = await engine().onWorkspaceStatusChanged(EVENT)

    expect(result).toMatchObject({ allow: false, reason: 'start_failed' })
    expect(result).toHaveProperty('detail', expect.stringContaining('did not become ready'))
    const [recorded] = db.listBoardTransitions('wt-1', 0)
    expect(recorded!.outcome).not.toBe('dispatched')
  })

  it('reuses one system Run per repo across dispatches', async () => {
    await engine().onWorkspaceStatusChanged(EVENT)
    await engine().onWorkspaceStatusChanged({ ...EVENT, worktreeId: 'wt-2' })

    const boardRuns = db.listRuns().runs.filter((run) => run.coordinator_handle === 'board:repo-1')
    expect(boardRuns).toHaveLength(1)
  })

  it('skips when orchestration is unavailable', async () => {
    const result = await createBoardRuleEngine({
      runtime: {} as never,
      getDb: () => null,
      rules: createBoardRuleStore(() => ({ boardAutomation: { rules: [RULE] } }) as never)
    }).onWorkspaceStatusChanged(EVENT)

    expect(result).toMatchObject({ allow: false, reason: 'skipped' })
  })

  describe('stage binding (WF3)', () => {
    const STAGE = {
      key: 'in-review',
      name: 'Review',
      ordinal: 0,
      memberId: 'member-from-stage',
      reversibility: 'contained' as const,
      inheritedCost: 'low' as const,
      requiredChecks: []
    }

    function withWorkflows(resolveColumn: () => unknown, rules: BoardAutomationRule[] = [RULE]) {
      return createBoardRuleEngine({
        runtime: {} as never,
        getDb: () => db,
        rules: createBoardRuleStore(() => ({ boardAutomation: { rules } }) as never),
        workflows: { resolveColumn: async () => resolveColumn() } as never
      })
    }

    // Why the stage wins: it carries reversibility and inherited_cost, which the autonomy policy
    // reads and an ad-hoc rule cannot express.
    it('dispatches the stage member rather than the rule member', async () => {
      const result = await withWorkflows(() => ({
        kind: 'stage',
        stage: STAGE,
        workflowId: 'wf-1',
        workflowVersion: 1
      })).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: true })
      expect(startWorkerForTask).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ member: 'member-from-stage' })
        })
      )
    })

    it('records the transition against the stage key', async () => {
      await withWorkflows(() => ({
        kind: 'stage',
        stage: STAGE,
        workflowId: 'wf-1',
        workflowVersion: 1
      })).onWorkspaceStatusChanged(EVENT)

      expect(db.listBoardTransitions('wt-1', 0)[0]).toMatchObject({ ruleId: 'in-review' })
    })

    // Why refuse: without the stage we would be guessing at reversibility, which ARCHITECTURE §7
    // says is authored and never inferred.
    it('refuses when the workflow cannot be read, rather than falling back to the rule', async () => {
      const result = await withWorkflows(() => ({
        kind: 'unavailable',
        detail: 'offline'
      })).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: false, reason: 'workflow_unavailable' })
      expect(startWorkerForTask).not.toHaveBeenCalled()
    })

    // Why: a project with no workflow is the pre-v1.5 shape the plan calls a degenerate one-stage
    // workflow, and its rules are the legitimate model.
    it('falls back to the ad-hoc rule when the project has no workflow', async () => {
      const result = await withWorkflows(() => ({ kind: 'none' })).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: true })
      expect(startWorkerForTask).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ member: 'member-reviewer' })
        })
      )
    })

    // Why not fall through: a workflow that deliberately does not stage a column means nothing
    // happens there, and a rule that would dispatch anyway defeats the authored model.
    it('dispatches nothing for a column the workflow leaves unstaged', async () => {
      const result = await withWorkflows(() => ({
        kind: 'no-stage',
        workflowId: 'wf-1',
        workflowVersion: 1
      })).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: false, reason: 'skipped' })
      expect(startWorkerForTask).not.toHaveBeenCalled()
    })

    // Merge and Deploy in the shipped template are human steps: no member, so nobody is dispatched.
    it('dispatches nobody for a stage with no member', async () => {
      const result = await withWorkflows(() => ({
        kind: 'stage',
        stage: { ...STAGE, memberId: null },
        workflowId: 'wf-1',
        workflowVersion: 1
      })).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: false, reason: 'skipped' })
    })

    // The stage says who runs; the column's rule still says what to say, because WF1 stages carry
    // no brief of their own.
    it('briefs the stage member with the column rule template when one exists', async () => {
      await withWorkflows(() => ({
        kind: 'stage',
        stage: STAGE,
        workflowId: 'wf-1',
        workflowVersion: 1
      })).onWorkspaceStatusChanged(EVENT)

      expect(createTaskInRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ spec: 'Review alc-49-board for ALC-49' })
      )
    })

    it('falls back to a plain brief naming the stage when no rule exists', async () => {
      await withWorkflows(
        () => ({ kind: 'stage', stage: STAGE, workflowId: 'wf-1', workflowVersion: 1 }),
        []
      ).onWorkspaceStatusChanged(EVENT)

      expect(createTaskInRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ spec: 'Review alc-49-board.' })
      )
    })
  })
})
