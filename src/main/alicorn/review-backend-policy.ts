import type { MemberBackend } from '../../shared/alicorn/members'

export type ReviewBackendVerdict =
  | { allowed: true; bypassed: boolean }
  | { allowed: false; reason: string }

/**
 * A reviewer must not run on a backend that authored the work — a model is a
 * poor judge of its own output (PROJECT-BRIEF §11.4).
 *
 * Enforced by default with an explicit opt-out, and a bypass is always recorded
 * even when the policy is off: the run report has to say the reviewer ran on the
 * author's backend, or accept rate drifts up while quality drifts down.
 */
export function evaluateReviewBackend(input: {
  reviewerBackend: MemberBackend
  authorBackends: ReadonlySet<string>
  enforce: boolean
  bypassRequested: boolean
}): ReviewBackendVerdict {
  if (!input.authorBackends.has(input.reviewerBackend)) {
    return { allowed: true, bypassed: false }
  }
  if (!input.enforce || input.bypassRequested) {
    return { allowed: true, bypassed: true }
  }
  return {
    allowed: false,
    reason: `Reviewer backend "${input.reviewerBackend}" matches the author backend. Pick a member on a different backend, or pass --allow-same-backend-review to record a bypass.`
  }
}
