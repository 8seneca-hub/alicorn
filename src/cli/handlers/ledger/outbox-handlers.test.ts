import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../../runtime-client'
import { LEDGER_OUTBOX_HANDLERS } from './outbox-handlers'
import type { OutboxListResult } from '../../../shared/alicorn/ledger-outbox-view'

const DEAD_ROW: OutboxListResult['rows'][number] = {
  id: 'lob_1',
  kind: 'step_outcome',
  dedupeKey: 'step_outcome:dispatch-1',
  attempts: 3,
  lastError: 'permanent rejection: 422 unprocessable',
  notBefore: null,
  deadAt: '2026-09-06T00:00:00.000Z',
  deadReason: 'permanent rejection: 422 unprocessable',
  createdAt: '2026-09-05T00:00:00.000Z'
}

function envelope<T>(result: T) {
  return { id: 'req-1', ok: true as const, result, _meta: { runtimeId: 'runtime-1' } }
}

describe('ledger outbox CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards --dead and --limit to ledger.outboxList', async () => {
    const call = vi.fn().mockResolvedValue(envelope<OutboxListResult>({ rows: [], deadCount: 0 }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox']({
      flags: new Map<string, string | boolean>([
        ['dead', true],
        ['limit', '10']
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(call).toHaveBeenCalledWith('ledger.outboxList', { dead: true, limit: 10 })
  })

  it('defaults dead to false when --dead is not given', async () => {
    const call = vi.fn().mockResolvedValue(envelope<OutboxListResult>({ rows: [], deadCount: 0 }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox']({
      flags: new Map(),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(call).toHaveBeenCalledWith('ledger.outboxList', { dead: false, limit: undefined })
  })

  it('prints the raw result as JSON with --json', async () => {
    const result: OutboxListResult = { rows: [DEAD_ROW], deadCount: 1 }
    const call = vi.fn().mockResolvedValue(envelope(result))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox']({
      flags: new Map([['dead', true]]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: true, result })
  })

  it('prints the dead count header, a column header, and one table row in text mode', async () => {
    const result: OutboxListResult = { rows: [DEAD_ROW], deadCount: 1 }
    const call = vi.fn().mockResolvedValue(envelope(result))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox']({
      flags: new Map([['dead', true]]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    const printed = String(log.mock.calls[0]?.[0])
    const lines = printed.split('\n')
    expect(lines[0]).toBe('dead: 1')
    expect(lines[1]).toBe('id | kind | attempts | last_error | dead_reason | dead_at')
    expect(lines[2]).toBe(
      'lob_1 | step_outcome | 3 | permanent rejection: 422 unprocessable | permanent rejection: 422 unprocessable | 2026-09-06T00:00:00.000Z'
    )
  })

  it('truncates a long last_error to 60 characters with an ellipsis in the table row', async () => {
    const longError = 'x'.repeat(120)
    const result: OutboxListResult = { rows: [{ ...DEAD_ROW, lastError: longError }], deadCount: 1 }
    const call = vi.fn().mockResolvedValue(envelope(result))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox']({
      flags: new Map(),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    const printed = String(log.mock.calls[0]?.[0])
    expect(printed).toContain(`| ${'x'.repeat(60)}… |`)
    expect(printed).not.toContain('x'.repeat(61))
  })

  it('prints "no pending rows" instead of a bare dead count when there are no due rows', async () => {
    const call = vi.fn().mockResolvedValue(envelope<OutboxListResult>({ rows: [], deadCount: 0 }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox']({
      flags: new Map(),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(String(log.mock.calls[0]?.[0])).toBe('no pending rows')
  })

  it('prints "no dead rows" instead of a bare dead count when --dead has no rows', async () => {
    const call = vi.fn().mockResolvedValue(envelope<OutboxListResult>({ rows: [], deadCount: 0 }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox']({
      flags: new Map([['dead', true]]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(String(log.mock.calls[0]?.[0])).toBe('no dead rows')
  })

  // Why: a misconfigured ledger URL parks every row in `pending` without dead-lettering any of
  // them, so "no dead rows" alone reads as healthy while the queue grows unboundedly (LG3).
  it('shows the pending backlog when --dead finds nothing but the table is not empty', async () => {
    const call = vi.fn().mockResolvedValue(
      envelope<OutboxListResult>({
        rows: [],
        deadCount: 0,
        counts: { pending: 41_208, sent: 12, dead: 0 }
      })
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox']({
      flags: new Map([['dead', true]]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(String(log.mock.calls[0]?.[0])).toBe('pending: 41208 | sent: 12 | dead: 0\nno dead rows')
  })
})

describe('ledger outbox-requeue CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards --id to ledger.outboxRequeue', async () => {
    const call = vi.fn().mockResolvedValue(envelope({ requeued: true }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox-requeue']({
      flags: new Map([['id', 'lob_1']]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(call).toHaveBeenCalledWith('ledger.outboxRequeue', { id: 'lob_1' })
  })

  it('prints the raw result as JSON with --json', async () => {
    const call = vi.fn().mockResolvedValue(envelope({ requeued: true }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox-requeue']({
      flags: new Map([['id', 'lob_1']]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      result: { requeued: true }
    })
  })

  it('reports requeued: false for an id that was not dead', async () => {
    const call = vi.fn().mockResolvedValue(envelope({ requeued: false }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox-requeue']({
      flags: new Map([['id', 'lob_2']]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(String(log.mock.calls[0]?.[0])).toContain('lob_2')
  })

  it('throws invalid_argument when --id is missing', async () => {
    const call = vi.fn()

    await expect(
      LEDGER_OUTBOX_HANDLERS['ledger outbox-requeue']({
        flags: new Map(),
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: false
      })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(call).not.toHaveBeenCalled()
  })

  it('throws invalid_argument when both --id and --all are given', async () => {
    const call = vi.fn()

    await expect(
      LEDGER_OUTBOX_HANDLERS['ledger outbox-requeue']({
        flags: new Map<string, string | boolean>([
          ['id', 'lob_1'],
          ['all', true]
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: false
      })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(call).not.toHaveBeenCalled()
  })

  it('forwards --all (and --kind) to ledger.outboxRequeue and prints the count', async () => {
    const call = vi.fn().mockResolvedValue(envelope({ requeuedCount: 3 }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await LEDGER_OUTBOX_HANDLERS['ledger outbox-requeue']({
      flags: new Map<string, string | boolean>([
        ['all', true],
        ['kind', 'interruption']
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(call).toHaveBeenCalledWith('ledger.outboxRequeue', { all: true, kind: 'interruption' })
    expect(String(log.mock.calls[0]?.[0])).toContain('3')
  })
})
