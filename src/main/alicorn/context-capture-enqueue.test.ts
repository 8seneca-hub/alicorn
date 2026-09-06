import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { enqueueContextCapture } from './context-capture-enqueue'

type OutboxRow = { kind: string; dedupe_key: string; payload: string }

describe('context capture enqueue', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  function rows(): OutboxRow[] {
    return db.db
      .prepare(`SELECT kind, dedupe_key, payload FROM ledger_outbox ORDER BY created_at`)
      .all() as OutboxRow[]
  }

  const base = {
    runId: 'run_1',
    taskId: 'task_1',
    dispatchId: 'ctx_1',
    contextSlice: { taskSpec: 'do the thing', workerHandle: 'term_w1', depth: 1 }
  }

  it('enqueues a small prompt inline', () => {
    enqueueContextCapture(db, { ...base, prompt: 'the exact prompt' })

    const [row] = rows()
    expect(row).toMatchObject({ kind: 'context_capture', dedupe_key: 'context_capture:ctx_1' })
    expect(JSON.parse(row!.payload)).toEqual({
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'ctx_1',
      prompt: 'the exact prompt',
      contextSlice: base.contextSlice
    })
  })

  // Why: the wire caps the prompt at 64 KB. Overflow goes to a file and the payload carries the
  // path, so a large brief is still captured rather than silently truncated or dropped.
  it('spills a prompt over the cap to a file and records the path', () => {
    const writePromptFile = vi.fn(() => '/data/alicorn/context-captures/ctx_1.md')
    const prompt = 'x'.repeat(70 * 1024)

    enqueueContextCapture(db, { ...base, prompt }, { writePromptFile })

    expect(writePromptFile).toHaveBeenCalledWith('ctx_1', prompt)
    const payload = JSON.parse(rows()[0]!.payload)
    expect(payload.promptPath).toBe('/data/alicorn/context-captures/ctx_1.md')
    expect(payload.prompt).toBeUndefined()
  })

  // Why: the cap is on bytes, not characters — a multi-byte prompt just under 64k characters is
  // over the limit on the wire and would be rejected.
  it('measures the cap in bytes, not characters', () => {
    const writePromptFile = vi.fn(() => '/tmp/ctx_1.md')
    // 40k characters, 3 bytes each = 120 KB.
    enqueueContextCapture(db, { ...base, prompt: '€'.repeat(40 * 1024) }, { writePromptFile })

    expect(writePromptFile).toHaveBeenCalled()
  })

  it('is idempotent per dispatch', () => {
    enqueueContextCapture(db, { ...base, prompt: 'first' })
    enqueueContextCapture(db, { ...base, prompt: 'second' })

    expect(rows()).toHaveLength(1)
    expect(JSON.parse(rows()[0]!.payload).prompt).toBe('first')
  })

  // Why: a capture is telemetry. It must never be the reason a dispatch fails.
  it('never throws when the spill file cannot be written', () => {
    const writePromptFile = vi.fn(() => {
      throw new Error('EACCES')
    })

    expect(() =>
      enqueueContextCapture(db, { ...base, prompt: 'y'.repeat(70 * 1024) }, { writePromptFile })
    ).not.toThrow()
    expect(rows()).toHaveLength(0)
  })

  it('never throws when the database rejects the row', () => {
    const broken = {
      enqueueLedgerOutbox: () => {
        throw new Error('database is locked')
      }
    } as unknown as OrchestrationDb

    expect(() => enqueueContextCapture(broken, { ...base, prompt: 'p' })).not.toThrow()
  })
})
