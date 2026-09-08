// Hand-mirrored from cloud/packages/control-plane-contract/src/rule-proposal.ts, the same way
// members.ts mirrors member.ts: the desktop does not import the contract package, so a rename
// there is a silent break here.

export const RULE_PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected'] as const
export type RuleProposalStatus = (typeof RULE_PROPOSAL_STATUSES)[number]

/** The human verdict that produced the proposal — never the proposal's own outcome. */
export type RuleProposalVerdict = 'amended' | 'rejected'

/** Assembled by the corrections sweep. Every field optional: a reopened task has no commit. */
export type RuleProposalContext = {
  sha?: string
  files?: string[]
  excerpt?: string
}

/** The contract caps the excerpt at 4096 characters and strips unknown keys; match it here. */
export const RULE_PROPOSAL_EXCERPT_MAX_CHARS = 4096
export const RULE_PROPOSAL_FILES_MAX = 200
/** AcceptBodySchema's cap in rule-proposals-routes.ts. */
export const RULE_TEXT_MAX_CHARS = 4000

export type RuleProposalInput = {
  memberId: string
  outcomeId: string
  verdict: RuleProposalVerdict
  context: RuleProposalContext
}

export type RuleProposal = RuleProposalInput & {
  id: string
  tenantId: string
  proposedRule: string | null
  status: RuleProposalStatus
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
}

/**
 * Why the accepted rule is *also* written to the repo: the standing rule lives on the Member, but
 * a rule nobody can read in a diff is invisible to everyone who is not looking at Settings. The
 * commit is best-effort and never blocks acceptance — `skipped` is a normal answer, not an error.
 */
export type RulebookCommitSkipReason =
  | 'not_requested'
  | 'no_origin_workspace'
  | 'remote_workspace'
  | 'not_a_git_repository'
  | 'dirty_worktree'
  | 'commit_failed'

export type RulebookCommitResult =
  | { status: 'committed'; filePath: string }
  | { status: 'skipped'; reason: RulebookCommitSkipReason; message?: string }

export type RuleProposalsListResult =
  | { ok: true; proposals: RuleProposal[] }
  | { ok: false; error: string }

export type RuleProposalDecisionResult =
  | { ok: true; proposal: RuleProposal; commit: RulebookCommitResult }
  | { ok: false; error: string }

/** `.alicorn/rules/<slug>.md` — one file per member, stable across renames of everything else. */
export function memberRuleFileSlug(memberName: string, memberId: string): string {
  const slug = memberName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  // Why the id suffix: two members may share a display name, and a rules file that silently
  // merges two members' constraints is worse than an ugly filename.
  return slug ? `${slug}-${memberId}` : memberId
}
