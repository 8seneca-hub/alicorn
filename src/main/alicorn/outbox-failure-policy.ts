import { ControlPlaneRequestError, ControlPlaneUnavailableError } from './control-plane-http'

export const MAX_OUTBOX_ATTEMPTS = 50

export type OutboxFailureDecision =
  | { action: 'retry' }
  | { action: 'dead'; reason: string }
  | { action: 'stop_pass'; reason: 'control_plane_unconfigured' | 'control_plane_unauthorized' }

// Why these codes: the server will never accept the same payload again, so retrying wastes attempts.
const PERMANENTLY_REJECTED_STATUSES = new Set([400, 404, 405, 409, 413, 415, 422])

// Why 401/403 is neither retry nor dead: it means auth is misconfigured, not that this row is bad.
export function classifyOutboxFailure(
  error: unknown,
  attemptsAfterThisFailure: number
): OutboxFailureDecision {
  if (error instanceof ControlPlaneUnavailableError) {
    return { action: 'stop_pass', reason: 'control_plane_unconfigured' }
  }
  if (error instanceof ControlPlaneRequestError) {
    if (error.status === 401 || error.status === 403) {
      return { action: 'stop_pass', reason: 'control_plane_unauthorized' }
    }
    if (PERMANENTLY_REJECTED_STATUSES.has(error.status)) {
      return { action: 'dead', reason: `${error.status} ${error.code}` }
    }
  }
  if (attemptsAfterThisFailure >= MAX_OUTBOX_ATTEMPTS) {
    return { action: 'dead', reason: 'max_attempts' }
  }
  return { action: 'retry' }
}
