import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { startVerificationWorker, type VerificationWorker } from './verification-worker'
import { ControlPlaneRequestError } from './control-plane-http'
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
      writer,
      { signal: expect.any(AbortSignal) }
    )
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
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
