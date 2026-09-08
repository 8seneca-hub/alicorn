import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { InterruptionsReport } from '../../../../shared/alicorn/ledger-report'

vi.mock('../../../alicorn/control-plane-http', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  const actual = await vi.importActual<typeof import('../../../alicorn/control-plane-http')>(
    '../../../alicorn/control-plane-http'
  )
  return { ...actual, alicornFetch: vi.fn() }
})

import {
  alicornFetch,
  ControlPlaneRequestError,
  ControlPlaneUnavailableError
} from '../../../alicorn/control-plane-http'
import { ALICORN_LEDGER_METHODS } from './alicorn-ledger'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeDispatcher(): RpcDispatcher {
  const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as OrcaRuntimeService
  return new RpcDispatcher({ runtime, methods: ALICORN_LEDGER_METHODS })
}

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response
}

const REPORT: InterruptionsReport = {
  filters: {},
  completedTaskDefinition: 'any_successful_step',
  completedTasks: 2,
  // Why 3 touched against 2 completed: one task's only step failed, so the strict and loose
  // denominators diverge — that divergence is the thing the report has to show.
  tasksTouched: 3,
  interruptions: 3,
  perCompletedTask: 1.5,
  perTaskTouched: 1,
  byKind: { gate: 2, ask: 1 },
  byStage: [
    {
      stageKey: 'build',
      completedTasks: 1,
      tasksTouched: 2,
      interruptions: 2,
      perCompletedTask: 2,
      perTaskTouched: 1
    },
    {
      stageKey: 'review',
      completedTasks: 1,
      tasksTouched: 1,
      interruptions: 1,
      perCompletedTask: 1,
      perTaskTouched: 1
    }
  ],
  excluded: ['permission_prompt']
}

beforeEach(() => {
  vi.mocked(alicornFetch).mockReset()
})

describe('ledger.report', () => {
  it('forwards the given filters as a query string and returns the report', async () => {
    vi.mocked(alicornFetch).mockResolvedValue(jsonResponse(REPORT))

    const response = await makeDispatcher().dispatch(
      makeRequest('ledger.report', {
        stageKey: 'build',
        projectId: 'proj_1',
        memberId: 'mem_1',
        runId: 'run_1',
        executionStrategy: 'orchestrated',
        since: '2026-01-01T00:00:00.000Z',
        until: '2026-02-01T00:00:00.000Z'
      })
    )

    expect(alicornFetch).toHaveBeenCalledWith(
      'ledger',
      '/v1/ledger/reports/interruptions?stageKey=build&projectId=proj_1&memberId=mem_1&runId=run_1&executionStrategy=orchestrated&since=2026-01-01T00%3A00%3A00.000Z&until=2026-02-01T00%3A00%3A00.000Z'
    )
    expect(response).toMatchObject({ ok: true, result: REPORT })
  })

  it('omits filters that were not given', async () => {
    vi.mocked(alicornFetch).mockResolvedValue(jsonResponse(REPORT))

    await makeDispatcher().dispatch(makeRequest('ledger.report'))

    expect(alicornFetch).toHaveBeenCalledWith('ledger', '/v1/ledger/reports/interruptions')
  })

  it('reports control_plane_unconfigured when the control plane is not configured', async () => {
    vi.mocked(alicornFetch).mockRejectedValue(new ControlPlaneUnavailableError())

    const response = await makeDispatcher().dispatch(makeRequest('ledger.report'))

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'control_plane_unconfigured' }
    })
  })

  it('reports a structured error carrying the status code on a request failure', async () => {
    vi.mocked(alicornFetch).mockRejectedValue(new ControlPlaneRequestError(500, 'internal_error'))

    const response = await makeDispatcher().dispatch(makeRequest('ledger.report'))

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'control_plane_request_failed',
        data: { status: 500, code: 'internal_error' }
      }
    })
  })
})

describe('ledger outbox operator view', () => {
  let db: OrchestrationDb
  let dispatcher: RpcDispatcher

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    dispatcher = new RpcDispatcher({ runtime, methods: ALICORN_LEDGER_METHODS })
  })

  afterEach(() => {
    db.close()
  })

  function seedDueAndDeadRows(): { dueId: string; deadId: string } {
    const due = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:due-1',
      payload: {}
    })
    const dead = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dead-1',
      payload: {}
    })
    db.markLedgerOutboxDead(dead.id, 'permanent rejection: 422 unprocessable')
    return { dueId: due.id, deadId: dead.id }
  }

  describe('ledger.outboxList', () => {
    it('defaults to the due rows and a dead count', async () => {
      const { dueId } = seedDueAndDeadRows()

      const response = await dispatcher.dispatch(makeRequest('ledger.outboxList'))

      expect(response.ok).toBe(true)
      expect(response).toMatchObject({
        ok: true,
        result: { rows: [{ id: dueId }], deadCount: 1 }
      })
    })

    it('returns the dead rows when dead: true', async () => {
      const { deadId } = seedDueAndDeadRows()

      const response = await dispatcher.dispatch(makeRequest('ledger.outboxList', { dead: true }))

      expect(response).toMatchObject({
        ok: true,
        result: {
          rows: [{ id: deadId, deadReason: 'permanent rejection: 422 unprocessable' }],
          deadCount: 1
        }
      })
    })

    it('falls back to the default limit for a negative --limit rather than an unbounded SQLite LIMIT -1', async () => {
      for (let i = 0; i < 30; i++) {
        db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: `due-${i}`, payload: {} })
      }

      const response = await dispatcher.dispatch(makeRequest('ledger.outboxList', { limit: -1 }))

      expect(response.ok).toBe(true)
      expect((response as { result: { rows: unknown[] } }).result.rows.length).toBeLessThanOrEqual(
        25
      )
    })
  })

  describe('ledger.outboxRequeue', () => {
    it('requeues a dead row so it becomes due again', async () => {
      const { deadId } = seedDueAndDeadRows()

      const response = await dispatcher.dispatch(
        makeRequest('ledger.outboxRequeue', { id: deadId })
      )

      expect(response).toMatchObject({ ok: true, result: { requeued: true } })
      expect(db.countDeadLedgerOutbox()).toBe(0)
    })

    it('returns requeued: false for an unknown id', async () => {
      const response = await dispatcher.dispatch(
        makeRequest('ledger.outboxRequeue', { id: 'lob_does_not_exist' })
      )

      expect(response).toMatchObject({ ok: true, result: { requeued: false } })
    })

    it('requeues all dead rows with --all and returns the count', async () => {
      const one = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'dead-1', payload: {} })
      const two = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'dead-2', payload: {} })
      const three = db.enqueueLedgerOutbox({
        kind: 'step_outcome',
        dedupeKey: 'dead-3',
        payload: {}
      })
      db.markLedgerOutboxDead(one.id, 'reason')
      db.markLedgerOutboxDead(two.id, 'reason')
      db.markLedgerOutboxDead(three.id, 'reason')

      const response = await dispatcher.dispatch(makeRequest('ledger.outboxRequeue', { all: true }))

      expect(response).toMatchObject({ ok: true, result: { requeuedCount: 3 } })
      expect(db.countDeadLedgerOutbox()).toBe(0)
    })

    it('requeues only the given --kind with --all', async () => {
      const outcome = db.enqueueLedgerOutbox({
        kind: 'step_outcome',
        dedupeKey: 'dead-outcome',
        payload: {}
      })
      const interruption = db.enqueueLedgerOutbox({
        kind: 'interruption',
        dedupeKey: 'dead-interruption',
        payload: {}
      })
      db.markLedgerOutboxDead(outcome.id, 'reason')
      db.markLedgerOutboxDead(interruption.id, 'reason')

      const response = await dispatcher.dispatch(
        makeRequest('ledger.outboxRequeue', { all: true, kind: 'interruption' })
      )

      expect(response).toMatchObject({ ok: true, result: { requeuedCount: 1 } })
      expect(db.countDeadLedgerOutbox()).toBe(1)
    })

    it('rejects when neither --id nor --all is given', async () => {
      const response = await dispatcher.dispatch(makeRequest('ledger.outboxRequeue', {}))

      expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    })

    it('rejects when both --id and --all are given', async () => {
      const { deadId } = seedDueAndDeadRows()

      const response = await dispatcher.dispatch(
        makeRequest('ledger.outboxRequeue', { id: deadId, all: true })
      )

      expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    })
  })
})
