import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { startVerificationWorker, type VerificationWorker } from './verification-worker'
import { ControlPlaneRequestError, ControlPlaneUnavailableError } from './control-plane-http'
import { UNAVAILABLE_LOG_INTERVAL_MS } from './ledger-outbox-drainer'
import type { LedgerWriter } from './ledger/ledger-writer'

const PAYLOAD = {
  dispatchId: 'dispatch_1',
  taskId: 'task_1',
  runId: 'run_1',
  worktreeId: 'wt_1',
  worktreePath: '/tmp/wt',
  branch: 'feature',
  projectId: 'proj_1'
}

function fakeWriter(): LedgerWriter {
  return {
    postStepOutcome: vi.fn(),
    patchStepOutcomeSpend: vi.fn(),
    patchHumanVerdict: vi.fn(),
    postStepVerification: vi.fn(),
    postContextCapture: vi.fn(),
    postInterruption: vi.fn()
  } as unknown as LedgerWriter
}

describe('startVerificationWorker', () => {
  let db: OrchestrationDb
  let worker: VerificationWorker | undefined

  afterEach(() => {
    worker?.stop()
    db?.close()
    vi.useRealTimers()
  })

  it('processes one due row: calls the runner once and marks it sent', async () => {
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:dispatch_1:diff_coverage',
      payload: PAYLOAD
    })
    const writer = fakeWriter()
    const verificationRunner = vi.fn().mockResolvedValue(undefined)
    worker = startVerificationWorker({
      getDb: () => db,
      writer,
      verificationRunner,
      intervalMs: 60_000
    })

    const result = await worker.tickOnce()

    expect(result).toEqual({ processed: 1, result: 'sent' })
    expect(verificationRunner).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchId: 'dispatch_1' }),
      // The runner is handed a writer that mirrors to disk first; the ledger post is unchanged.
      expect.objectContaining({ postStepVerification: expect.any(Function) }),
      { signal: expect.any(AbortSignal) }
    )
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
  })

  it('mirrors each result to the local store before posting it to the ledger', async () => {
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:dispatch_1:diff_coverage',
      payload: PAYLOAD
    })
    const writer = fakeWriter()
    // A gate must still see the result when the ledger post fails — the mirror runs first.
    vi.mocked(writer.postStepVerification).mockRejectedValue(
      new ControlPlaneUnavailableError('down')
    )
    worker = startVerificationWorker({
      getDb: () => db,
      writer,
      verificationRunner: async (payload, handedWriter) => {
        await handedWriter
          .postStepVerification({
            runId: payload.runId,
            taskId: payload.taskId,
            dispatchId: payload.dispatchId,
            kind: 'diff_coverage',
            name: 'Diff coverage ≥ 80%',
            required: true,
            status: 'passed',
            detail: { covered: 0.93 }
          })
          .catch(() => undefined)
      },
      intervalMs: 60_000
    })

    await worker.tickOnce()

    const rows = db.listTaskVerifications('task_1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'diff_coverage', status: 'passed', required: true })
  })

  it('dead-letters the row when the runner throws a non-retryable 404', async () => {
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:dispatch_1:diff_coverage',
      payload: PAYLOAD
    })
    const writer = fakeWriter()
    const verificationRunner = vi
      .fn()
      .mockRejectedValue(new ControlPlaneRequestError(404, 'not_found'))
    worker = startVerificationWorker({
      getDb: () => db,
      writer,
      verificationRunner,
      intervalMs: 60_000
    })

    const result = await worker.tickOnce()

    expect(result).toEqual({ processed: 1, result: 'dead' })
    expect(db.countDeadLedgerOutbox()).toBe(1)
    expect(db.listDeadLedgerOutbox()[0].dead_reason).toBe('404 not_found')
  })

  it('retries with a verification_row_timeout error, without dead-lettering, when the runner never resolves within rowTimeoutMs', async () => {
    vi.useFakeTimers()
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:dispatch_1:diff_coverage',
      payload: PAYLOAD
    })
    const writer = fakeWriter()
    const verificationRunner = vi.fn(() => new Promise<void>(() => {}))
    worker = startVerificationWorker({
      getDb: () => db,
      writer,
      verificationRunner,
      intervalMs: 60_000,
      rowTimeoutMs: 5_000
    })

    const tick = worker.tickOnce()
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await tick

    expect(result).toEqual({ processed: 1, result: 'retry' })
    const farFuture = new Date(Date.now() + 120_000).toISOString()
    const row = db.listDueLedgerOutbox(25, farFuture)[0]
    expect(row.attempts).toBe(1)
    expect(row.last_error).toContain('verification_row_timeout')
    expect(row.dead_at).toBeNull()
  })

  it('clears the row-timeout timer even when the runner throws synchronously', async () => {
    vi.useFakeTimers()
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:dispatch_1:diff_coverage',
      payload: PAYLOAD
    })
    const writer = fakeWriter()
    const verificationRunner = vi.fn(() => {
      throw new Error('boom')
    })
    worker = startVerificationWorker({
      getDb: () => db,
      writer,
      verificationRunner,
      intervalMs: 60_000,
      rowTimeoutMs: 5_000
    })
    // Why stop() first: isolates the row-timeout timer under test from the worker's
    // own recurring tick-schedule timer, which is unrelated to this leak.
    worker.stop()

    const result = await worker.tickOnce()

    expect(result).toEqual({ processed: 1, result: 'retry' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('processes two due rows one per tick', async () => {
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:a',
      payload: PAYLOAD
    })
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:b',
      payload: PAYLOAD
    })
    const writer = fakeWriter()
    const verificationRunner = vi.fn().mockResolvedValue(undefined)
    worker = startVerificationWorker({
      getDb: () => db,
      writer,
      verificationRunner,
      intervalMs: 60_000
    })

    const result = await worker.tickOnce()

    expect(result).toEqual({ processed: 1, result: 'sent' })
    expect(verificationRunner).toHaveBeenCalledTimes(1)
    expect(db.listDueLedgerOutbox()).toHaveLength(1)
  })

  it('the in-flight guard skips an overlapping tick', async () => {
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:a',
      payload: PAYLOAD
    })
    const writer = fakeWriter()
    let resolveRunner: () => void = () => {}
    const verificationRunner = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRunner = resolve
        })
    )
    worker = startVerificationWorker({
      getDb: () => db,
      writer,
      verificationRunner,
      intervalMs: 60_000
    })

    const first = worker.tickOnce()
    const second = await worker.tickOnce()

    expect(second).toEqual({ processed: 0, result: 'idle' })
    expect(verificationRunner).toHaveBeenCalledTimes(1)

    resolveRunner()
    expect(await first).toEqual({ processed: 1, result: 'sent' })
  })

  it('pauses after stop_pass: the runner is not called again until the interval elapses', async () => {
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:dispatch_1:diff_coverage',
      payload: PAYLOAD
    })
    const writer = fakeWriter()
    const verificationRunner = vi.fn().mockRejectedValue(new ControlPlaneUnavailableError())
    let currentNow = 0
    worker = startVerificationWorker({
      getDb: () => db,
      writer,
      verificationRunner,
      intervalMs: 60_000,
      now: () => currentNow
    })

    const first = await worker.tickOnce()
    expect(first).toEqual({ processed: 1, result: 'stop_pass' })
    expect(verificationRunner).toHaveBeenCalledTimes(1)

    const second = await worker.tickOnce()
    expect(second).toEqual({ processed: 0, result: 'idle' })
    expect(verificationRunner).toHaveBeenCalledTimes(1)

    currentNow += UNAVAILABLE_LOG_INTERVAL_MS
    const third = await worker.tickOnce()
    expect(third).toEqual({ processed: 1, result: 'stop_pass' })
    expect(verificationRunner).toHaveBeenCalledTimes(2)
  })

  it('warns only once across a paused stretch, not once per tick', async () => {
    db = new OrchestrationDb(':memory:')
    db.enqueueLedgerOutbox({
      kind: 'step_verification',
      dedupeKey: 'step_verification:dispatch_1:diff_coverage',
      payload: PAYLOAD
    })
    const writer = fakeWriter()
    const verificationRunner = vi.fn().mockRejectedValue(new ControlPlaneUnavailableError())
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    worker = startVerificationWorker({
      getDb: () => db,
      writer,
      verificationRunner,
      intervalMs: 60_000
    })

    await worker.tickOnce()
    await worker.tickOnce()
    await worker.tickOnce()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('stop() clears the interval so tickOnce no longer runs on a schedule', () => {
    vi.useFakeTimers()
    db = new OrchestrationDb(':memory:')
    const getDb = vi.fn(() => db)
    worker = startVerificationWorker({
      getDb,
      writer: fakeWriter(),
      verificationRunner: vi.fn(),
      intervalMs: 1_000
    })
    worker.stop()
    vi.advanceTimersByTime(5_000)
    expect(getDb).not.toHaveBeenCalled()
  })
})
