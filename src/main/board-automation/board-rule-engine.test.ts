import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardAutomationRule } from '../../shared/global-settings-types'
import type { WorkflowStage } from '../../shared/alicorn/workflows'
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
      key: 'review',
      name: 'Review',
      ordinal: 0,
      memberId: 'member-from-stage',
      columnId: 'in-review',
      kind: 'worker' as const,
      codeCommand: null,
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

      expect(db.listBoardTransitions('wt-1', 0)[0]).toMatchObject({ ruleId: 'review' })
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

    // Regression: WF4's template keys stages by pipeline step (spec, build, review, …) while board
    // columns are todo/in-progress/in-review/completed — verified against the seeded stack, no
    // overlap. Treating an unstaged column as authored silence took automation down entirely and
    // bypassed the rules that did work.
    it('falls back to the rule for a column the workflow leaves unstaged', async () => {
      const result = await withWorkflows(() => ({
        kind: 'no-stage',
        workflowId: 'wf-1',
        workflowVersion: 1
      })).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: true })
      expect(startWorkerForTask).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ member: 'member-reviewer' })
        })
      )
    })

    it('dispatches nothing when a column is unstaged and has no rule either', async () => {
      const result = await withWorkflows(
        () => ({ kind: 'no-stage', workflowId: 'wf-1', workflowVersion: 1 }),
        []
      ).onWorkspaceStatusChanged(EVENT)

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

  describe('code stages (WF5)', () => {
    const CODE_STAGE: WorkflowStage = {
      key: 'format',
      name: 'Format',
      ordinal: 0,
      memberId: null,
      columnId: 'in-review',
      kind: 'code' as const,
      codeCommand: 'pnpm format',
      reversibility: 'contained' as const,
      inheritedCost: 'low' as const,
      requiredChecks: []
    }

    const BUILD_STAGE: WorkflowStage = {
      ...CODE_STAGE,
      key: 'build',
      name: 'Build',
      kind: 'worker',
      codeCommand: null,
      columnId: 'in-progress'
    }
    const DONE_STAGE: WorkflowStage = {
      ...BUILD_STAGE,
      key: 'qa',
      name: 'QA',
      columnId: 'completed'
    }

    // The shape WF5 is built around: a forward edge onward and a correction edge back.
    const GRAPH = {
      stages: [BUILD_STAGE, CODE_STAGE, DONE_STAGE],
      transitions: [
        { from: 'format', to: 'qa', kind: 'forward' as const, trigger: { kind: 'on_success' as const } },
        { from: 'format', to: 'build', kind: 'correction' as const, trigger: { kind: 'on_failure' as const } }
      ]
    }

    function withCodeStage(
      runCode: unknown,
      stage = CODE_STAGE,
      resolveWorktreeHost?: (worktreeId: string) => Promise<'local' | 'remote' | 'unknown'>,
      workflow: unknown = GRAPH
    ) {
      return createBoardRuleEngine({
        runtime: {} as never,
        getDb: () => db,
        rules: createBoardRuleStore(() => ({ boardAutomation: { rules: [RULE] } }) as never),
        workflows: {
          resolveColumn: async () => ({
            kind: 'stage',
            stage,
            workflow,
            workflowId: 'wf-1',
            workflowVersion: 1
          })
        } as never,
        runCode: runCode as never,
        ...(resolveWorktreeHost ? { resolveWorktreeHost } : {})
      })
    }

    function exits(exitCode: number, tails: { stdout?: string; stderr?: string } = {}) {
      return vi.fn(async () => ({
        exitCode,
        durationMs: 1,
        stdoutTail: tails.stdout ?? '',
        stderrTail: tails.stderr ?? '',
        timedOut: false
      }))
    }

    // Why never a member: routing deterministic work through a model is the most common waste the
    // framework names, and it also makes the result non-reproducible.
    it('runs the command and dispatches nobody', async () => {
      const runCode = vi.fn(async () => ({
        exitCode: 0,
        durationMs: 5,
        stdoutTail: 'formatted',
        stderrTail: '',
        timedOut: false
      }))

      const result = await withCodeStage(runCode).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: true, ranCode: { stageKey: 'format', exitCode: 0 } })
      expect(startWorkerForTask).not.toHaveBeenCalled()
      expect(runCode).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'pnpm format', worktreePath: EVENT.worktreePath })
      )
    })

    // Every step is recorded, and a step that ran without a model is exactly the one worth being
    // able to prove ran at all. It goes through the outbox, never a direct post.
    it('records the outcome in the ledger outbox, with no member and the code backend', async () => {
      const runCode = vi.fn(async () => ({
        exitCode: 0,
        durationMs: 3,
        stdoutTail: 'formatted 2 files',
        stderrTail: '',
        timedOut: false
      }))

      await withCodeStage(runCode).onWorkspaceStatusChanged(EVENT)

      const rows = db.listDueLedgerOutbox(10)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'step_outcome' })
      expect(JSON.parse(rows[0]!.payload)).toMatchObject({
        source: 'code',
        outcome: {
          backend: 'code',
          stageKey: 'format',
          outcome: 'succeeded',
          worktreeId: 'wt-1',
          repoId: 'repo-1',
          reportSummary: 'formatted 2 files'
        }
      })
    })

    it('records a failed code stage in the ledger too', async () => {
      const runCode = vi.fn(async () => ({
        exitCode: 2,
        durationMs: 3,
        stdoutTail: '',
        stderrTail: 'prettier: parse error',
        timedOut: false
      }))

      await withCodeStage(runCode).onWorkspaceStatusChanged(EVENT)

      expect(JSON.parse(db.listDueLedgerOutbox(10)[0]!.payload)).toMatchObject({
        outcome: { outcome: 'failed', reportSummary: 'prettier: parse error' }
      })
    })

    // A refusal never ran anything, so there is nothing to measure — recording one would inflate
    // the very counts the autonomy policy reads.
    it('records nothing in the ledger when it refuses a remote code stage', async () => {
      await withCodeStage(vi.fn(), CODE_STAGE, async () => 'remote').onWorkspaceStatusChanged(EVENT)

      expect(db.listDueLedgerOutbox(10)).toEqual([])
    })

    it('records the transition so the ceiling counts a code stage too', async () => {
      const runCode = vi.fn(async () => ({
        exitCode: 0,
        durationMs: 1,
        stdoutTail: '',
        stderrTail: '',
        timedOut: false
      }))

      await withCodeStage(runCode).onWorkspaceStatusChanged(EVENT)

      expect(db.listBoardTransitions('wt-1', 0)[0]).toMatchObject({
        outcome: 'dispatched',
        ruleId: 'format'
      })
    })

    // Why surface the failure: a code stage is deterministic, so a non-zero exit is a real result
    // the board should show rather than something to retry blindly.
    it('reports a non-zero exit with the command output', async () => {
      const runCode = vi.fn(async () => ({
        exitCode: 2,
        durationMs: 1,
        stdoutTail: '',
        stderrTail: 'prettier: 3 files changed',
        timedOut: false
      }))

      const result = await withCodeStage(runCode).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: false, reason: 'code_failed' })
      expect(result).toHaveProperty('detail', expect.stringContaining('prettier'))
    })

    describe('routing', () => {
      // Exit 0 is the only success, and a successful stage hands the workspace on rather than
      // waiting for someone to drag the card.
      it('hands the workspace to the forward edge on exit 0', async () => {
        const result = await withCodeStage(exits(0)).onWorkspaceStatusChanged(EVENT)

        expect(result).toMatchObject({ allow: true, moveToStatusId: 'completed' })
      })

      // The return edge is a first-class part of the graph, not an error path bolted on.
      it('hands the workspace back along the correction edge on a non-zero exit', async () => {
        const result = await withCodeStage(exits(2)).onWorkspaceStatusChanged(EVENT)

        expect(result).toMatchObject({
          allow: false,
          reason: 'code_failed',
          moveToStatusId: 'in-progress'
        })
      })

      // Gate by blast radius, not by confidence: a failure the graph does not handle is unverified
      // work, and unverified work never advances on its own.
      it('gates a failure the workflow has no correction edge for', async () => {
        const noReturn = { ...GRAPH, transitions: [GRAPH.transitions[0]] }

        const result = await withCodeStage(
          exits(2, { stderr: 'tsc: 4 errors' }),
          CODE_STAGE,
          undefined,
          noReturn
        ).onWorkspaceStatusChanged(EVENT)

        expect(result).toMatchObject({ allow: false, reason: 'code_gated' })
        expect(result).not.toHaveProperty('moveToStatusId')
      })

      it('raises a gate a human can answer, and records it as an interruption', async () => {
        const noReturn = { ...GRAPH, transitions: [] }

        const result = (await withCodeStage(
          exits(2, { stderr: 'tsc: 4 errors' }),
          CODE_STAGE,
          undefined,
          noReturn
        ).onWorkspaceStatusChanged(EVENT)) as { gateId: string }

        const gate = db.getGate(result.gateId)
        expect(gate).toMatchObject({ status: 'pending' })
        expect(gate?.question).toContain('tsc: 4 errors')
        const interruption = db.listDueLedgerOutbox(10).find((row) => row.kind === 'interruption')
        expect(JSON.parse(interruption!.payload)).toMatchObject({
          kind: 'gate',
          sourceId: result.gateId
        })
      })

      // A terminal stage is the end of the chain, not something to interrupt anyone over.
      it('moves nowhere when a stage succeeds with no forward edge', async () => {
        const result = await withCodeStage(exits(0), CODE_STAGE, undefined, {
          ...GRAPH,
          transitions: []
        }).onWorkspaceStatusChanged(EVENT)

        expect(result).toMatchObject({ allow: true })
        expect(result).not.toHaveProperty('moveToStatusId')
      })
    })

    // A code stage with nothing to run cannot complete; the contract rejects it, and the engine
    // does not invent a command for it either.
    it('does nothing for a code stage with no command', async () => {
      const runCode = vi.fn()

      const result = await withCodeStage(runCode, {
        ...CODE_STAGE,
        codeCommand: null
      }).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: false, reason: 'skipped' })
      expect(runCode).not.toHaveBeenCalled()
    })

    // `worktreePath` is a path on the *execution* host. Running it locally for an SSH workspace
    // either fails or — worse — hits a same-named local directory and reports success for work
    // that never touched the real workspace. Same reasoning as the diff-coverage skip.
    it('refuses a code stage on a remote worktree instead of running it locally', async () => {
      const runCode = vi.fn()

      const result = await withCodeStage(
        runCode,
        CODE_STAGE,
        async () => 'remote'
      ).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: false, reason: 'code_unsupported_remote' })
      expect(runCode).not.toHaveBeenCalled()
    })

    // Nothing is recorded, so the refusal costs the workspace none of its dispatch ceiling.
    it('records no transition when it refuses a remote code stage', async () => {
      await withCodeStage(vi.fn(), CODE_STAGE, async () => 'remote').onWorkspaceStatusChanged(EVENT)

      expect(db.listBoardTransitions('wt-1', 0)).toEqual([])
    })

    // An unreadable host is treated as local, matching the verification runner: refusing every
    // stage the moment the runtime hiccups would be worse than running where we already are.
    it('runs a code stage when the host cannot be resolved', async () => {
      const runCode = vi.fn(async () => ({
        exitCode: 0,
        durationMs: 1,
        stdoutTail: '',
        stderrTail: '',
        timedOut: false
      }))

      const result = await withCodeStage(
        runCode,
        CODE_STAGE,
        async () => 'unknown'
      ).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: true })
      expect(runCode).toHaveBeenCalled()
    })

    it('still refuses a code stage when the board is killed', async () => {
      db.setBoardAutomationDisabled('board:repo-1', 'nghia')
      const runCode = vi.fn()

      const result = await withCodeStage(runCode).onWorkspaceStatusChanged(EVENT)

      expect(result).toMatchObject({ allow: false, reason: 'killed' })
      expect(runCode).not.toHaveBeenCalled()
    })
  })
})
