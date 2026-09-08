import type { ExecutionHostId } from '../../shared/execution-host'
import type { HostedReviewExecutionOptions } from '../source-control/hosted-review-git-options'
import { getCurrentBranch } from '../source-control/hosted-review-creation-git-state'
import { hostedReviewSshConnectionId } from '../source-control/hosted-review-execution-host'
import { readPullRequestTemplate } from '../github/client/create/pull-request-template'
import { getControlPlaneClient } from '../alicorn/control-plane-client-instance'
import { composeReviewBody, renderProvenanceMarkdown } from '../alicorn/provenance-markdown'
import { readProvenanceView } from '../alicorn/provenance-source'

export type ComposedHostedReviewBody = {
  body: string | undefined
  useTemplate: boolean | undefined
}

/**
 * Appends the run's provenance to a pull-request body. Runs before
 * `createHostedReview`, so every forge provider gets the same section.
 *
 * Never throws: a pull request must not fail to open because the ledger is
 * unreachable. Any failure returns the caller's body untouched.
 */
export async function composeHostedReviewBodyWithProvenance(args: {
  repoId: string
  worktreePath: string
  executionHostId: ExecutionHostId
  executionOptions?: HostedReviewExecutionOptions
  body: string | undefined
  useTemplate: boolean | undefined
  head?: string
}): Promise<ComposedHostedReviewBody> {
  const unchanged: ComposedHostedReviewBody = { body: args.body, useTemplate: args.useTemplate }
  try {
    const branch =
      args.head ??
      (await getCurrentBranch(args.worktreePath, args.executionHostId, args.executionOptions ?? {}))
    const view = await readProvenanceView(getControlPlaneClient(), args.repoId, branch)
    if (!view) {
      return unchanged
    }
    const provenance = renderProvenanceMarkdown(view)
    return composeReviewBody({
      body: args.body,
      useTemplate: args.useTemplate,
      readTemplate: () =>
        readPullRequestTemplate(
          args.worktreePath,
          hostedReviewSshConnectionId(args.executionHostId)
        ),
      provenance
    })
  } catch {
    return unchanged
  }
}
