/**
 * D4's escalation offer, plus MR2's second signal into it.
 *
 * An offer is exactly that: `execution_strategy: single` stays the default and nothing switches
 * until a human accepts. Two independent facts can raise one — a session filling its context
 * window, and a task bound to more than one repository — but a task is offered once, which
 * `markEscalationOffered` enforces at the write rather than here.
 */
import { ALICORN_CONTEXT_CEILING_TOKENS } from './context-ceiling'

export type EscalationSignal = 'context_ceiling' | 'multi_repo'

export type EscalationOffer = {
  taskId: string
  dispatchId: string
  paneKey: string | null
  /** Which fact raised the offer; the renderer says so rather than guessing a reason. */
  signal: EscalationSignal
  /** Measured context for `context_ceiling`; null when the other signal raised the offer. */
  contextTokens: number | null
  /** Distinct repos in the task's feature workspace for `multi_repo`; null otherwise. */
  repoCount: number | null
}

export type EscalationSignalInput = {
  /** Distinct repos bound to the task. 0 for a task that binds none — the pre-MR1 shape. */
  repoCount: number
  /** Null when the backend is not one we can measure — never a guess. */
  contextTokens: number | null
  ceilingTokens?: number
}

export type EscalationSignalDecision = Pick<
  EscalationOffer,
  'signal' | 'contextTokens' | 'repoCount'
>

/**
 * Why multi-repo wins a tie: it is true from the moment the task is bound and costs one COUNT,
 * where the ceiling is only reached late in a run, and it is the more actionable of the two to
 * say out loud — "this touches three repos" tells the user what is different about the work.
 */
export function evaluateEscalationSignal(
  input: EscalationSignalInput
): EscalationSignalDecision | null {
  if (input.repoCount > 1) {
    return { signal: 'multi_repo', contextTokens: null, repoCount: input.repoCount }
  }
  const ceiling = input.ceilingTokens ?? ALICORN_CONTEXT_CEILING_TOKENS
  if (input.contextTokens !== null && input.contextTokens >= ceiling) {
    return { signal: 'context_ceiling', contextTokens: input.contextTokens, repoCount: null }
  }
  return null
}
