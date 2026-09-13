import type { GitHubStack, NumberedHostedReviewSummary } from './github-stack-api-responses'

/**
 * Whether the two reviews already sit next to each other in the same stack, and which stack that is.
 *
 * A pure reading of what the API returned, kept apart from the calls that fetch it: this is the one
 * piece of stacked-PR logic that can be reasoned about — and got wrong — without a network.
 */
export function registeredStackNumber(
  parentReview: NumberedHostedReviewSummary,
  currentReview: NumberedHostedReviewSummary,
  parentStacks: GitHubStack[],
  currentStacks: GitHubStack[]
): number | null {
  const parentStack = parentStacks[0]
  const currentStack = currentStacks[0]
  if (!parentStack || !currentStack || parentStack.number !== currentStack.number) {
    return null
  }
  const parentPosition = parentStack.pull_requests.findIndex(
    (pullRequest) => pullRequest.number === parentReview.number
  )
  // Why: a miss is -1, and -1 + 1 reads the first entry — which reports "already
  // registered" whenever the current PR heads a stack the parent has left.
  if (parentPosition === -1) {
    return null
  }
  return parentStack.pull_requests[parentPosition + 1]?.number === currentReview.number
    ? parentStack.number
    : null
}
