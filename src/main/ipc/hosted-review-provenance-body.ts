import type { ExecutionHostId } from '../../shared/execution-host'
import type { HostedReviewExecutionOptions } from '../source-control/hosted-review-git-options'
import { getCurrentBranch } from '../source-control/hosted-review-creation-git-state'
import { hostedReviewSshConnectionId } from '../source-control/hosted-review-execution-host'
import { readPullRequestTemplate } from '../github/client/create/pull-request-template'
import { getControlPlaneClient } from '../alicorn/control-plane-client-instance'
import { composeReviewBody, renderProvenanceMarkdown } from '../alicorn/provenance-markdown'

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
    const client = getControlPlaneClient()
    const report = await client.getProvenance(args.repoId, branch).catch(() => null)
    if (!report) {
      return unchanged
    }
    const policy = await client.getOrgPolicy().catch(() => ({
      // Fail closed for display too: claiming the rule was off when we could not
      // read it would understate a bypass.
      enforceDistinctReviewerBackend: true
    }))
    const members = await client.listMembers().catch(() => [])
    const nameById = new Map<string, string>(
      members.map((member) => [member.id, member.name] as const)
    )
    const provenance = renderProvenanceMarkdown(report, {
      policyEnforced: policy.enforceDistinctReviewerBackend,
      memberName: (id) => nameById.get(id)
    })
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
