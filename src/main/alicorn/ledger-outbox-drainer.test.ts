import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { createRootDispatch } from '../runtime/orchestration/db/root-dispatch-test-fixture'
import { startLedgerOutboxDrainer, type LedgerOutboxDrainer } from './ledger-outbox-drainer'
import { ControlPlaneRequestError, ControlPlaneUnavailableError } from './control-plane-http'
import type { LedgerWriter } from './ledger/ledger-writer'

const WORKTREE = {
  id: 'wt_1',
  repoId: 'repo_1',
  projectId: 'proj_1',
  path: '/tmp/wt',
  branch: 'feature'
}

function fakeWriter(overrides?: Partial<LedgerWriter>): LedgerWriter {
  return {
    postStepOutcome: vi.fn().mockResolvedValue({ id: 'so_1', duplicate: false }),
    patchStepOutcomeSpend: vi.fn().mockResolvedValue(undefined),
    postStepVerification: vi.fn().mockResolvedValue({ id: 'sv_1', duplicate: false }),
    postContextCapture: vi.fn().mockResolvedValue({ id: 'cc_1', duplicate: false }),
    ...overrides
  }
}

describe('startLedgerOutboxDrainer', () => {
  let db: OrchestrationDb
  let drainer: LedgerOutboxDrainer | undefined

  afterEach(() => {
    drainer?.stop()
    db?.close()
  })

  // Settling the worker report is how production enqueues the step_outcome row (C2);
  // reusing it here keeps the fixture identical to the real path.
  function settleSucceededWithWorktree(): { taskId: string; dispatchId: string } {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.markWorkerDispatchReady(dispatch.id)
    db.recordWorkerStage({
      dispatchId: dispatch.id,
      stage: 'input_accepted',
      worktreeId: WORKTREE.id
    })
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded',
      result: JSON.stringify({ phase: 'build', body: 'done', filesModified: [] })
    })
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  it('posts a step outcome, marks it sent, and enqueues follow-up rows', async () => {
    const { dispatchId } = settleSucceededWithWorktree()
    const writer = fakeWriter()
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn().mockResolvedValue(WORKTREE) },
      writer,
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(writer.postStepOutcome).toHaveBeenCalledTimes(1)
    expect(db.listDueLedgerOutbox()).toHaveLength(1) // step_verification, due now
    expect(db.listDueLedgerOutbox()[0].kind).toBe('step_verification')
    expect(JSON.parse(db.listDueLedgerOutbox()[0].payload)).toMatchObject({
      dispatchId,
      worktreeId: WORKTREE.id,
      worktreePath: WORKTREE.path,
      branch: WORKTREE.branch,
      projectId: WORKTREE.projectId
    })

    const farFuture = new Date(Date.now() + 120_000).toISOString()
    const dueLater = db.listDueLedgerOutbox(25, farFuture)
    expect(dueLater.map((row) => row.kind).sort()).toEqual([
      'spend_attribution',
      'step_verification'
    ])
    const spendRow = dueLater.find((row) => row.kind === 'spend_attribution')!
    expect(spendRow.dedupe_key).toBe(`spend_attribution:${dispatchId}`)
    expect(JSON.parse(spendRow.payload)).toMatchObject({ dispatchId, outcomeId: 'so_1' })
    const notBeforeMs = new Date(spendRow.not_before!).getTime()
    expect(notBeforeMs - Date.now()).toBeGreaterThan(55_000)
    expect(notBeforeMs - Date.now()).toBeLessThan(65_000)
  })

  it('backs off with attempts + 1 on a normal request failure, leaving the row unsent', async () => {
    settleSucceededWithWorktree()
    const writer = fakeWriter({
      postStepOutcome: vi.fn().mockRejectedValue(new ControlPlaneRequestError(500, 'server_error'))
    })
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn().mockResolvedValue(WORKTREE) },
      writer,
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 0, failed: 1 })
    const farFuture = new Date(Date.now() + 120_000).toISOString()
    const row = db.listDueLedgerOutbox(25, farFuture)[0]
    expect(row.kind).toBe('step_outcome')
    expect(row.attempts).toBe(1)
    expect(row.last_error).toContain('server_error')
    expect(row.sent_at).toBeNull()
    expect(new Date(row.not_before!).getTime()).toBeGreaterThan(Date.now())
  })

  it('processes a mixed batch: a normal failure on one row does not block a later row from succeeding', async () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    db.enqueueLedgerOutbox({
      kind: 'context_capture',
      dedupeKey: 'context_capture:row-1',
      payload: {
        runId: task.run_id,
        taskId: task.id,
        dispatchId: dispatch.id,
        prompt: 'one',
        contextSlice: {}
      }
    })
    db.enqueueLedgerOutbox({
      kind: 'context_capture',
      dedupeKey: 'context_capture:row-2',
      payload: {
        runId: task.run_id,
        taskId: task.id,
        dispatchId: dispatch.id,
        prompt: 'two',
        contextSlice: {}
      }
    })
    const postContextCapture = vi
      .fn()
      .mockRejectedValueOnce(new ControlPlaneRequestError(500, 'boom'))
      .mockResolvedValueOnce({ id: 'cc_2', duplicate: false })
    const writer = fakeWriter({ postContextCapture })
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer,
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, failed: 1 })
    expect(postContextCapture).toHaveBeenCalledTimes(2)
    const farFuture = new Date(Date.now() + 120_000).toISOString()
    const stillDue = db.listDueLedgerOutbox(25, farFuture)
    expect(stillDue).toHaveLength(1) // only row 1; row 2 was sent
    expect(stillDue[0].dedupe_key).toBe('context_capture:row-1')
    expect(stillDue[0].attempts).toBe(1)
    expect(stillDue[0].last_error).toContain('boom')
    expect(new Date(stillDue[0].not_before!).getTime()).toBeGreaterThan(Date.now())
  })

  it('backs off a step_outcome row whose task no longer exists, without ever deleting it', async () => {
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:missing-dispatch',
      payload: {
        taskId: 'missing-task',
        dispatchId: 'missing-dispatch',
        outcome: 'succeeded',
        result: '{}'
      }
    })
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer: fakeWriter(),
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 0, failed: 1 })
    const farFuture = new Date(Date.now() + 120_000).toISOString()
    const row = db.listDueLedgerOutbox(25, farFuture)[0]
    expect(row.attempts).toBe(1)
    expect(row.last_error).toContain('unknown task')
  })

  it('leaves the row untouched (no attempts bump) when the control plane is unavailable', async () => {
    settleSucceededWithWorktree()
    const writer = fakeWriter({
      postStepOutcome: vi.fn().mockRejectedValue(new ControlPlaneUnavailableError())
    })
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn().mockResolvedValue(WORKTREE) },
      writer,
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 0, failed: 0 })
    const row = db.listDueLedgerOutbox()[0]
    expect(row.attempts).toBe(0)
    expect(row.last_error).toBeNull()
    expect(row.not_before).toBeNull()
    expect(row.sent_at).toBeNull()
  })

  it('stops the pass and logs once per 5 minutes when the writer itself is null', async () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: `step_outcome:${dispatch.id}`,
      payload: { taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded', result: '{}' }
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer: null,
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 60_000
    })

    const first = await drainer.drainOnce()
    expect(first).toEqual({ sent: 0, failed: 0 })
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // Still inside the 5-minute window: the second call must not log again.
    vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'))
    const second = await drainer.drainOnce()
    expect(second).toEqual({ sent: 0, failed: 0 })
    expect(warnSpy).toHaveBeenCalledTimes(1)

    const row = db.listDueLedgerOutbox()[0]
    expect(row.attempts).toBe(0)
    expect(row.last_error).toBeNull()
    expect(row.sent_at).toBeNull()

    warnSpy.mockRestore()
    vi.useRealTimers()
  })

  it('warns once on a row’s first failure, then throttles a second failure within 5 minutes', async () => {
    settleSucceededWithWorktree()
    const writer = fakeWriter({
      postStepOutcome: vi.fn().mockRejectedValue(new ControlPlaneRequestError(500, 'boom-1'))
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn().mockResolvedValue(WORKTREE) },
      writer,
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 60_000
    })

    await drainer.drainOnce()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[ledger-outbox] row failed',
      expect.objectContaining({ kind: 'step_outcome', attempts: 0, message: '500 boom-1' })
    )

    // Still inside the 5-minute throttle window: a second failing row must not log again.
    vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'))
    writer.postStepOutcome = vi.fn().mockRejectedValue(new ControlPlaneRequestError(500, 'boom-2'))
    await drainer.drainOnce()
    expect(warnSpy).toHaveBeenCalledTimes(1)

    warnSpy.mockRestore()
    vi.useRealTimers()
  })

  it('leaves a spend_attribution row untouched and continues with other kinds when the handler is null', async () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    db.enqueueLedgerOutbox({
      kind: 'spend_attribution',
      dedupeKey: `spend_attribution:${dispatch.id}`,
      payload: {
        dispatchId: dispatch.id,
        taskId: task.id,
        outcomeId: 'so_1',
        backend: 'claude',
        worktreeId: null,
        startedAt: null,
        completedAt: null
      }
    })
    db.enqueueLedgerOutbox({
      kind: 'context_capture',
      dedupeKey: `context_capture:${dispatch.id}`,
      payload: {
        runId: task.run_id,
        taskId: task.id,
        dispatchId: dispatch.id,
        prompt: 'hi',
        contextSlice: {}
      }
    })
    const writer = fakeWriter()
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer,
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(writer.postContextCapture).toHaveBeenCalledTimes(1)
    const remaining = db.listDueLedgerOutbox()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].kind).toBe('spend_attribution')
    expect(remaining[0].attempts).toBe(0)
  })

  it('runs the verification runner for a step_verification row and marks it sent', async () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: `step_verification:${dispatch.id}:diff_coverage`,
      payload: {
        dispatchId: dispatch.id,
        taskId: task.id,
        runId: task.run_id,
        worktreeId: WORKTREE.id,
        worktreePath: WORKTREE.path,
        branch: WORKTREE.branch,
        projectId: WORKTREE.projectId
      }
    })
    const writer = fakeWriter()
    const verificationRunner = vi.fn().mockResolvedValue(undefined)
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer,
      spendAttributor: null,
      verificationRunner,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(verificationRunner).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchId: dispatch.id, worktreeId: WORKTREE.id }),
      writer
    )
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
  })

  it('resolves a worktree through runtime.showManagedWorktree and tolerates it throwing', async () => {
    const { dispatchId } = settleSucceededWithWorktree()
    const writer = fakeWriter()
    const showManagedWorktree = vi.fn().mockRejectedValue(new Error('worktree gone'))
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree },
      writer,
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(showManagedWorktree).toHaveBeenCalledWith(`id:${WORKTREE.id}`)
    expect(result).toEqual({ sent: 1, failed: 0 })
    // No worktree resolved → no step_verification row, only spend_attribution (not due yet).
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
    const farFuture = new Date(Date.now() + 120_000).toISOString()
    expect(db.listDueLedgerOutbox(25, farFuture).map((row) => row.kind)).toEqual([
      'spend_attribution'
    ])
    void dispatchId
  })

  it('stop() clears the interval so drainOnce no longer runs on a schedule', () => {
    db = new OrchestrationDb(':memory:')
    vi.useFakeTimers()
    const getDb = vi.fn(() => db)
    const writer = fakeWriter()
    drainer = startLedgerOutboxDrainer({
      getDb,
      runtime: { showManagedWorktree: vi.fn() },
      writer,
      spendAttributor: null,
      verificationRunner: null,
      intervalMs: 1_000
    })
    drainer.stop()
    vi.advanceTimersByTime(5_000)
    expect(getDb).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
