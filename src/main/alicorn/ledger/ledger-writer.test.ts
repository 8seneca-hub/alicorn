import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLedgerWriter } from './ledger-writer'
import type { alicornFetch as AlicornFetch } from '../control-plane-http'
import type {
  ContextCaptureInput,
  SpendPatch,
  StepOutcomeInput,
  StepVerificationInput
} from '../../../shared/alicorn/ledger-inputs'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return { ok: true, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
})

const STEP_OUTCOME_INPUT: StepOutcomeInput = {
  runId: 'run_1',
  taskId: 'task_1',
  dispatchId: 'ctx_1',
  backend: 'claude',
  stageKey: 'build',
  executionStrategy: 'single',
  outcome: 'succeeded',
  filesModified: [],
  reviewBackendBypass: false,
  escalationOffered: false,
  escalationAccepted: null
}

describe('createLedgerWriter', () => {
  it('posts a step outcome to the right path and maps the response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'so_1', duplicate: false }))
    const writer = createLedgerWriter({ fetch: fetchMock as unknown as typeof AlicornFetch })

    const result = await writer.postStepOutcome(STEP_OUTCOME_INPUT)

    expect(fetchMock).toHaveBeenCalledWith(
      'ledger',
      '/v1/ledger/step-outcomes',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(STEP_OUTCOME_INPUT) })
    )
    expect(result).toEqual({ id: 'so_1', duplicate: false })
  })

  it('patches step outcome spend at the right path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'so_1' }))
    const writer = createLedgerWriter({ fetch: fetchMock as unknown as typeof AlicornFetch })
    const patch: SpendPatch = { spendCents: 120, usage: { tokens: 100 } }

    await writer.patchStepOutcomeSpend('so_1', patch)

    expect(fetchMock).toHaveBeenCalledWith(
      'ledger',
      '/v1/ledger/step-outcomes/so_1/spend',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(patch) })
    )
  })

  it('posts a step verification and maps the response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'sv_1', duplicate: false }))
    const writer = createLedgerWriter({ fetch: fetchMock as unknown as typeof AlicornFetch })
    const input: StepVerificationInput = {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'ctx_1',
      kind: 'diff_coverage',
      name: 'diff coverage',
      required: true,
      status: 'passed',
      detail: {}
    }

    const result = await writer.postStepVerification(input)

    expect(fetchMock).toHaveBeenCalledWith(
      'ledger',
      '/v1/ledger/step-verifications',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) })
    )
    expect(result).toEqual({ id: 'sv_1', duplicate: false })
  })

  it('posts a context capture and maps the response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'cc_1', duplicate: true }))
    const writer = createLedgerWriter({ fetch: fetchMock as unknown as typeof AlicornFetch })
    const input: ContextCaptureInput = {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'ctx_1',
      prompt: 'hello',
      contextSlice: {}
    }

    const result = await writer.postContextCapture(input)

    expect(fetchMock).toHaveBeenCalledWith(
      'ledger',
      '/v1/ledger/context-captures',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) })
    )
    expect(result).toEqual({ id: 'cc_1', duplicate: true })
  })
})
