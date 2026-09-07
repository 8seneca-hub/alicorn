import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { buildCodeStageOutcome, enqueueCodeStageOutcome } from './code-stage-outcome-enqueue'

const RESULT = {
  exitCode: 0,
  durationMs: 12,
  stdoutTail: 'formatted 3 files',
  stderrTail: '',
  timedOut: false
}

const INPUT = {
  runId: 'run-1',
  taskId: 'task-1',
  stageKey: 'format',
  projectId: 'proj-1',
  repoId: 'repo-1',
  worktreeId: 'wt-1',
  branch: 'alc-92',
  result: RESULT
}

describe('code stage outcome', () => {
  // A code stage is a step like any other; the whole point of the ledger is that every step is
  // recorded, and one that runs without a model is exactly the one worth being able to prove.
  it('records a succeeded outcome with no member and the code backend', () => {
    const outcome = buildCodeStageOutcome(INPUT)

    expect(outcome).toMatchObject({
      runId: 'run-1',
      taskId: 'task-1',
      dispatchId: 'code-task-1',
      backend: 'code',
      stageKey: 'format',
      outcome: 'succeeded',
      executionStrategy: 'single',
      reportSummary: 'formatted 3 files',
      filesModified: [],
      reviewBackendBypass: false,
      escalationOffered: false,
      escalationAccepted: null
    })
    expect(outcome).not.toHaveProperty('memberId')
  })

  it('fails on any non-zero exit', () => {
    expect(buildCodeStageOutcome({ ...INPUT, result: { ...RESULT, exitCode: 2 } })).toMatchObject({
      outcome: 'failed'
    })
  })

  // The reason a stage failed is normally on stderr; recording an empty summary for the case a
  // human most needs to read would be the wrong trade.
  it('summarises a failure from stderr, and a success from stdout', () => {
    const failed = buildCodeStageOutcome({
      ...INPUT,
      result: { ...RESULT, exitCode: 1, stderrTail: 'prettier: parse error' }
    })

    expect(failed.reportSummary).toBe('prettier: parse error')
    expect(buildCodeStageOutcome(INPUT).reportSummary).toBe('formatted 3 files')
  })

  it('falls back to stdout when a failing stage said nothing on stderr', () => {
    const failed = buildCodeStageOutcome({
      ...INPUT,
      result: { ...RESULT, exitCode: 1, stdoutTail: 'nothing to format' }
    })

    expect(failed.reportSummary).toBe('nothing to format')
  })

  it('reports a timeout as a failure under the shell exit code', () => {
    expect(
      buildCodeStageOutcome({
        ...INPUT,
        result: { ...RESULT, exitCode: 124, timedOut: true }
      })
    ).toMatchObject({ outcome: 'failed' })
  })

  it('truncates a stage key to the ledger limit', () => {
    expect(buildCodeStageOutcome({ ...INPUT, stageKey: 'k'.repeat(200) }).stageKey).toHaveLength(64)
  })

  describe('through the outbox', () => {
    let db: OrchestrationDb

    beforeEach(() => {
      db = new OrchestrationDb(':memory:')
    })

    afterEach(() => {
      db.close()
    })

    it('enqueues one row rather than posting to the ledger', () => {
      enqueueCodeStageOutcome(db, INPUT)

      const rows = db.listDueLedgerOutbox(10)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'step_outcome' })
      expect(JSON.parse(rows[0]!.payload)).toMatchObject({
        source: 'code',
        outcome: { backend: 'code', stageKey: 'format' }
      })
    })

    // Exactly-once: a crash that replays the same execution must not double-count the step, and
    // the ledger's autonomy policy reads these counts.
    it('is exactly-once for one execution of the stage', () => {
      enqueueCodeStageOutcome(db, INPUT)
      enqueueCodeStageOutcome(db, INPUT)

      expect(db.listDueLedgerOutbox(10)).toHaveLength(1)
    })

    it('records a later execution of the same stage as its own step', () => {
      enqueueCodeStageOutcome(db, INPUT)
      enqueueCodeStageOutcome(db, { ...INPUT, taskId: 'task-2' })

      expect(db.listDueLedgerOutbox(10)).toHaveLength(2)
    })
  })
})
