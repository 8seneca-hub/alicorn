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
    patchHumanVerdict: vi.fn().mockResolvedValue('patched'),
    postStepVerification: vi.fn().mockResolvedValue({ id: 'sv_1', duplicate: false }),
    postContextCapture: vi.fn().mockResolvedValue({ id: 'cc_1', duplicate: false }),
    postInterruption: vi.fn().mockResolvedValue({ id: 'int_1', duplicate: false }),
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
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, retried: 0, dead: 0 })
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

  it('stores the dispatch↔outcome id mapping after a step_outcome post', async () => {
    const { dispatchId } = settleSucceededWithWorktree()
    const writer = fakeWriter()
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn().mockResolvedValue(WORKTREE) },
      writer,
      spendAttributor: null,
      intervalMs: 60_000
    })

    await drainer.drainOnce()

    expect(db.getDispatchLedgerOutcome(dispatchId)).toBe('so_1')
  })

  it('stores the dispatch↔outcome id mapping on a duplicate-200 step_outcome post too', async () => {
    const { dispatchId } = settleSucceededWithWorktree()
    const writer = fakeWriter({
      postStepOutcome: vi.fn().mockResolvedValue({ id: 'so_dup', duplicate: true })
    })
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn().mockResolvedValue(WORKTREE) },
      writer,
      spendAttributor: null,
      intervalMs: 60_000
    })

    await drainer.drainOnce()

    expect(db.getDispatchLedgerOutcome(dispatchId)).toBe('so_dup')
  })

  it('routes a human_verdict_patch row to writer.patchHumanVerdict and marks it sent', async () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    db.enqueueLedgerOutbox({
      kind: 'human_verdict_patch',
      dedupeKey: `human_verdict_patch:${dispatch.id}`,
      payload: {
        outcomeId: 'so_1',
        humanVerdict: 'accepted',
        amendedAfterMs: null,
        source: 'follow_up_commit'
      }
    })
    const writer = fakeWriter()
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer,
      spendAttributor: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, retried: 0, dead: 0 })
    expect(writer.patchHumanVerdict).toHaveBeenCalledWith('so_1', {
      humanVerdict: 'accepted',
      amendedAfterMs: null,
      source: 'follow_up_commit'
    })
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
  })

  it('marks a human_verdict_patch row sent even when the writer reports already_set', async () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    db.enqueueLedgerOutbox({
      kind: 'human_verdict_patch',
      dedupeKey: `human_verdict_patch:${dispatch.id}`,
      payload: {
        outcomeId: 'so_1',
        humanVerdict: 'rejected',
        amendedAfterMs: null,
        source: 'revert'
      }
    })
    const writer = fakeWriter({ patchHumanVerdict: vi.fn().mockResolvedValue('already_set') })
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer,
      spendAttributor: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, retried: 0, dead: 0 })
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
  })

  it('routes an interruption row to writer.postInterruption and marks it sent', async () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: 'work' })
    const dispatch = createRootDispatch(db, task.id, 'term_worker')
    const interruptionInput = {
      runId: task.run_id,
      taskId: task.id,
      dispatchId: dispatch.id,
      kind: 'gate' as const,
      sourceId: 'gate_1',
      resolvedBy: null,
      occurredAt: '2026-09-06T00:00:00.000Z'
    }
    db.enqueueLedgerOutbox({
      kind: 'interruption',
      dedupeKey: `interruption:gate:gate_1`,
      payload: interruptionInput
    })
    const writer = fakeWriter()
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer,
      spendAttributor: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, retried: 0, dead: 0 })
    expect(writer.postInterruption).toHaveBeenCalledWith(interruptionInput)
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
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
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 0, retried: 1, dead: 0 })
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
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, retried: 1, dead: 0 })
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
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 0, retried: 1, dead: 0 })
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
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 0, retried: 0, dead: 0 })
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
      intervalMs: 60_000
    })

    const first = await drainer.drainOnce()
    expect(first).toEqual({ sent: 0, retried: 0, dead: 0 })
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // Still inside the 5-minute window: the second call must not log again.
    vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'))
    const second = await drainer.drainOnce()
    expect(second).toEqual({ sent: 0, retried: 0, dead: 0 })
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
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, retried: 0, dead: 0 })
    expect(writer.postContextCapture).toHaveBeenCalledTimes(1)
    const remaining = db.listDueLedgerOutbox()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].kind).toBe('spend_attribution')
    expect(remaining[0].attempts).toBe(0)
  })

  // step_verification is owned by the verification worker (LG2a); production wiring
  // excludes it from this drainer's fetch, but a row is left untouched even if it
  // does reach here, rather than being silently miscounted as sent.
  it('leaves a step_verification row untouched even without excludeKinds', async () => {
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
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer,
      spendAttributor: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 0, retried: 0, dead: 0 })
    const row = db.listDueLedgerOutbox()[0]
    expect(row.kind).toBe('step_verification')
    expect(row.attempts).toBe(0)
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
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(showManagedWorktree).toHaveBeenCalledWith(`id:${WORKTREE.id}`)
    expect(result).toEqual({ sent: 1, retried: 0, dead: 0 })
    // No worktree resolved → no step_verification row, only spend_attribution (not due yet).
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
    const farFuture = new Date(Date.now() + 120_000).toISOString()
    expect(db.listDueLedgerOutbox(25, farFuture).map((row) => row.kind)).toEqual([
      'spend_attribution'
    ])
    void dispatchId
  })

  it('dead-letters a row on a 404, with a single "row dead" warn', async () => {
    settleSucceededWithWorktree()
    const writer = fakeWriter({
      postStepOutcome: vi.fn().mockRejectedValue(new ControlPlaneRequestError(404, 'not_found'))
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn().mockResolvedValue(WORKTREE) },
      writer,
      spendAttributor: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 0, retried: 0, dead: 1 })
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
    expect(db.countDeadLedgerOutbox()).toBe(1)
    expect(db.listDeadLedgerOutbox()[0].dead_reason).toBe('404 not_found')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[ledger-outbox] row dead',
      expect.objectContaining({ kind: 'step_outcome', reason: '404 not_found' })
    )

    warnSpy.mockRestore()
  })

  it('stops the pass on a 403, leaving rows untouched, with a throttled warn mentioning unauthorized', async () => {
    settleSucceededWithWorktree()
    const writer = fakeWriter({
      postStepOutcome: vi.fn().mockRejectedValue(new ControlPlaneRequestError(403, 'forbidden'))
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn().mockResolvedValue(WORKTREE) },
      writer,
      spendAttributor: null,
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 0, retried: 0, dead: 0 })
    const row = db.listDueLedgerOutbox()[0]
    expect(row.attempts).toBe(0)
    expect(row.last_error).toBeNull()
    expect(row.sent_at).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('unauthorized')

    warnSpy.mockRestore()
  })

  it('excludes kinds via excludeKinds so they are never fetched', async () => {
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
    db.enqueueLedgerOutbox({
      kind: 'interruption',
      dedupeKey: 'interruption:gate:gate_1',
      payload: {
        runId: task.run_id,
        taskId: task.id,
        dispatchId: dispatch.id,
        kind: 'gate' as const,
        sourceId: 'gate_1',
        resolvedBy: null,
        occurredAt: '2026-09-06T00:00:00.000Z'
      }
    })
    const writer = fakeWriter()
    drainer = startLedgerOutboxDrainer({
      getDb: () => db,
      runtime: { showManagedWorktree: vi.fn() },
      writer,
      spendAttributor: null,
      excludeKinds: ['step_verification'],
      intervalMs: 60_000
    })

    const result = await drainer.drainOnce()

    expect(result).toEqual({ sent: 1, retried: 0, dead: 0 })
    expect(writer.postInterruption).toHaveBeenCalledTimes(1)
    const stepVerificationRow = db
      .listDueLedgerOutbox()
      .find((row) => row.kind === 'step_verification')
    expect(stepVerificationRow).toBeDefined()
    expect(stepVerificationRow!.attempts).toBe(0)
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
      intervalMs: 1_000
    })
    drainer.stop()
    vi.advanceTimersByTime(5_000)
    expect(getDb).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
