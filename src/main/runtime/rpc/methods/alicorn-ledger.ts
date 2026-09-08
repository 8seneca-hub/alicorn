import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalBoolean, OptionalPositiveInt, OptionalString } from '../schemas'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import {
  alicornFetch,
  ControlPlaneRequestError,
  ControlPlaneUnavailableError
} from '../../../alicorn/control-plane-http'
import type { InterruptionsReport } from '../../../../shared/alicorn/ledger-report'
import type { OutboxListRow, OutboxListResult } from '../../../../shared/alicorn/ledger-outbox-view'
import type { LedgerOutboxKind, LedgerOutboxRow } from '../../orchestration/db/alicorn/alicorn-rows'

const LedgerReportParams = z.object({
  stageKey: OptionalString,
  projectId: OptionalString,
  memberId: OptionalString,
  runId: OptionalString,
  executionStrategy: OptionalString,
  since: OptionalString,
  until: OptionalString
})

// Why: a fixed order keeps the query string (and its test assertions) stable.
const QUERY_FIELDS = [
  'stageKey',
  'projectId',
  'memberId',
  'runId',
  'executionStrategy',
  'since',
  'until'
] as const

const OutboxListParams = z.object({
  dead: OptionalBoolean,
  limit: OptionalPositiveInt
})

const OutboxRequeueParams = z
  .object({
    id: OptionalString,
    all: OptionalBoolean,
    kind: OptionalString
  })
  .superRefine((params, ctx) => {
    if (Boolean(params.id) === Boolean(params.all)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of --id or --all'
      })
    }
  })

// Why: the wire shape is camelCase; the DB row mirrors SQLite columns directly.
function toOutboxListRow(row: LedgerOutboxRow): OutboxListRow {
  return {
    id: row.id,
    kind: row.kind,
    dedupeKey: row.dedupe_key,
    attempts: row.attempts,
    lastError: row.last_error,
    notBefore: row.not_before,
    deadAt: row.dead_at,
    deadReason: row.dead_reason,
    createdAt: row.created_at
  }
}

export const ALICORN_LEDGER_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'ledger.report',
    params: LedgerReportParams,
    handler: async (params) => {
      const query = new URLSearchParams()
      for (const field of QUERY_FIELDS) {
        const value = params[field]
        if (value) {
          query.set(field, value)
        }
      }
      const qs = query.toString()
      try {
        const response = await alicornFetch(
          'ledger',
          `/v1/ledger/reports/interruptions${qs ? `?${qs}` : ''}`
        )
        return (await response.json()) as InterruptionsReport
      } catch (error) {
        if (error instanceof ControlPlaneUnavailableError) {
          throw new OrchestrationError(error.code, 'Alicorn control plane is not configured.')
        }
        if (error instanceof ControlPlaneRequestError) {
          throw new OrchestrationError(
            'control_plane_request_failed',
            `Ledger request failed: ${error.status} ${error.code}`,
            { status: error.status, code: error.code }
          )
        }
        throw error
      }
    }
  }),

  defineMethod({
    name: 'ledger.outboxList',
    params: OutboxListParams,
    handler: (params, { runtime }): OutboxListResult => {
      const db = runtime.getOrchestrationDb()
      const rows = params.dead
        ? db.listDeadLedgerOutbox(params.limit)
        : db.listDueLedgerOutbox(params.limit, new Date().toISOString())
      // Why the whole-table counts and not just the listed page: a misconfigured ledger URL parks
      // every row in `pending` without ever dead-lettering, so `dead: 0` reads healthy while the
      // queue grows unboundedly (LG3). The pending total is the only signal that contradicts it.
      return {
        rows: rows.map(toOutboxListRow),
        deadCount: db.countDeadLedgerOutbox(),
        counts: db.countLedgerOutbox()
      }
    }
  }),

  defineMethod({
    name: 'ledger.outboxRequeue',
    params: OutboxRequeueParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      if (params.all) {
        return {
          requeuedCount: db.requeueAllDeadLedgerOutbox(params.kind as LedgerOutboxKind | undefined)
        }
      }
      return { requeued: db.requeueLedgerOutbox(params.id as string) }
    }
  })
]
