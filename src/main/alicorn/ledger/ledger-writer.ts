import type { alicornFetch as AlicornFetch } from '../control-plane-http'
import { alicornFetch, ControlPlaneRequestError } from '../control-plane-http'
import type {
  ContextCaptureInput,
  GateAgreementPatch,
  HumanVerdictPatch,
  InterruptionInput,
  SpendPatch,
  StepOutcomeInput,
  StepVerificationInput
} from '../../../shared/alicorn/ledger-inputs'

export type LedgerWriter = {
  postStepOutcome(input: StepOutcomeInput): Promise<{ id: string; duplicate: boolean }>
  patchStepOutcomeSpend(id: string, patch: SpendPatch): Promise<void>
  patchHumanVerdict(outcomeId: string, patch: HumanVerdictPatch): Promise<'patched' | 'already_set'>
  patchGateAgreement(
    outcomeId: string,
    patch: GateAgreementPatch
  ): Promise<'patched' | 'already_set'>
  postStepVerification(input: StepVerificationInput): Promise<{ id: string; duplicate: boolean }>
  postContextCapture(input: ContextCaptureInput): Promise<{ id: string; duplicate: boolean }>
  postInterruption(input: InterruptionInput): Promise<{ id: string; duplicate: boolean }>
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

    patchHumanVerdict: async (outcomeId, patch) => {
      try {
        await request(
          'ledger',
          `/v1/ledger/step-outcomes/${encodeURIComponent(outcomeId)}/human-verdict`,
          { method: 'PATCH', body: JSON.stringify(patch) }
        )
        return 'patched'
      } catch (error) {
        // Why: a second verdict on an already-settled outcome is append-only noise, not a failure.
        if (error instanceof ControlPlaneRequestError && error.status === 409) {
          return 'already_set'
        }
        throw error
      }
    },

    patchGateAgreement: async (outcomeId, patch) => {
      try {
        await request(
          'ledger',
          `/v1/ledger/step-outcomes/${encodeURIComponent(outcomeId)}/gate-agreement`,
          { method: 'PATCH', body: JSON.stringify(patch) }
        )
        return 'patched'
      } catch (error) {
        // A gate resolves once, so a 409 means this row already landed — settled, not failed.
        if (error instanceof ControlPlaneRequestError && error.status === 409) {
          return 'already_set'
        }
        throw error
      }
    },

    postStepVerification: (input) => postJson('/v1/ledger/step-verifications', input),

    postContextCapture: (input) => postJson('/v1/ledger/context-captures', input),

    postInterruption: (input) => postJson('/v1/ledger/interruptions', input)
  }
}
