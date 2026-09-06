import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalString } from '../schemas'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import {
  alicornFetch,
  ControlPlaneRequestError,
  ControlPlaneUnavailableError
} from '../../../alicorn/control-plane-http'
import type { InterruptionsReport } from '../../../../shared/alicorn/ledger-report'

const LedgerReportParams = z.object({
  stageKey: OptionalString,
  projectId: OptionalString,
  memberId: OptionalString,
  since: OptionalString,
  until: OptionalString
})

// Why: a fixed order keeps the query string (and its test assertions) stable.
const QUERY_FIELDS = ['stageKey', 'projectId', 'memberId', 'since', 'until'] as const

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
  })
]
