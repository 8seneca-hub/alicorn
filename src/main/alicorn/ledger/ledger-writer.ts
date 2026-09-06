import type { alicornFetch as AlicornFetch } from '../control-plane-http'
import { alicornFetch } from '../control-plane-http'
import type {
  ContextCaptureInput,
  SpendPatch,
  StepOutcomeInput,
  StepVerificationInput
} from '../../../shared/alicorn/ledger-inputs'

export type LedgerWriter = {
  postStepOutcome(input: StepOutcomeInput): Promise<{ id: string; duplicate: boolean }>
  patchStepOutcomeSpend(id: string, patch: SpendPatch): Promise<void>
  postStepVerification(input: StepVerificationInput): Promise<{ id: string; duplicate: boolean }>
  postContextCapture(input: ContextCaptureInput): Promise<{ id: string; duplicate: boolean }>
}

/**
 * Ledger writes over B1's `alicornFetch` only (R9) — no dependency on B2's
 * `ControlPlaneClient` or D2's `MemberDirectory`.
 */
export function createLedgerWriter(deps?: { fetch?: typeof AlicornFetch }): LedgerWriter {
  const request = deps?.fetch ?? alicornFetch

  async function postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await request('ledger', path, { method: 'POST', body: JSON.stringify(body) })
    return (await response.json()) as T
  }

  return {
    postStepOutcome: (input) => postJson('/v1/ledger/step-outcomes', input),

    patchStepOutcomeSpend: async (id, patch) => {
      await request('ledger', `/v1/ledger/step-outcomes/${encodeURIComponent(id)}/spend`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      })
    },

    postStepVerification: (input) => postJson('/v1/ledger/step-verifications', input),

    postContextCapture: (input) => postJson('/v1/ledger/context-captures', input)
  }
}
