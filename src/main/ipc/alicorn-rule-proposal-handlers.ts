import { ipcMain } from 'electron'
import { ALICORN_IPC } from '../../shared/alicorn/ipc-channels'
import type { ControlPlaneClient } from '../alicorn/control-plane-client'
import { asNonEmptyString, attemptControlPlane } from './alicorn-control-plane-result'
import type {
  RuleProposal,
  RuleProposalDecisionResult,
  RuleProposalsListResult,
  RuleProposalStatus,
  RulebookCommitResult
} from '../../shared/alicorn/rule-proposals'
import { RULE_PROPOSAL_STATUSES, RULE_TEXT_MAX_CHARS } from '../../shared/alicorn/rule-proposals'
import type { RulebookCommitRequest } from '../alicorn/rulebook/rulebook-commit'

export type AlicornRuleProposalDeps = {
  client: ControlPlaneClient | null
  /**
   * Writes an accepted rule into the repo. Absent — or refusing — leaves the rule on the member
   * alone: the server-side append is what makes acceptance real, the commit only makes it visible
   * to everyone who is not looking at Settings.
   */
  commitAcceptedRule?: (request: RulebookCommitRequest) => Promise<RulebookCommitResult>
}

function asRuleProposalStatus(value: unknown): RuleProposalStatus | undefined {
  return (RULE_PROPOSAL_STATUSES as readonly unknown[]).includes(value)
    ? (value as RuleProposalStatus)
    : undefined
}

/** RB1's IPC surface: read what a correction proposed, then let a human accept or reject it. */
export function registerAlicornRuleProposalHandlers(deps: AlicornRuleProposalDeps): void {
  async function commitAcceptedRule(input: {
    proposal: RuleProposal
    rule: string
    memberName: string | null
    worktreeId: string | null
    requested: boolean
  }): Promise<RulebookCommitResult> {
    if (!input.requested || !deps.commitAcceptedRule) {
      return { status: 'skipped', reason: 'not_requested' }
    }
    try {
      return await deps.commitAcceptedRule({
        worktreeId: input.worktreeId,
        memberId: input.proposal.memberId,
        memberName: input.memberName ?? input.proposal.memberId,
        proposalId: input.proposal.id,
        rule: input.rule
      })
    } catch (error) {
      // The rule is already on the member; a thrown commit must not read as a failed acceptance.
      return {
        status: 'skipped',
        reason: 'commit_failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  ipcMain.handle(
    ALICORN_IPC.ruleProposalsList,
    async (
      _event,
      args: { memberId?: unknown; status?: unknown }
    ): Promise<RuleProposalsListResult> => {
      const memberId = asNonEmptyString(args?.memberId)
      if (!memberId) {
        return { ok: false, error: 'invalid_body' }
      }
      return attemptControlPlane(deps.client, async (client) => ({
        ok: true as const,
        proposals: await client.listRuleProposals(memberId, asRuleProposalStatus(args?.status))
      }))
    }
  )

  // The human action. The rule text comes from the pane's textarea and the accepting actor from
  // the request's own bearer, server-side — a member can neither write nor accept its own rule.
  ipcMain.handle(
    ALICORN_IPC.ruleProposalsAccept,
    async (
      _event,
      args: {
        id?: unknown
        rule?: unknown
        memberName?: unknown
        worktreeId?: unknown
        commitToRepo?: unknown
      }
    ): Promise<RuleProposalDecisionResult> => {
      const id = asNonEmptyString(args?.id)
      const rule = asNonEmptyString(args?.rule)
      if (!id || !rule || rule.length > RULE_TEXT_MAX_CHARS) {
        return { ok: false, error: 'invalid_body' }
      }
      return attemptControlPlane(deps.client, async (client) => {
        const proposal = await client.acceptRuleProposal(id, rule)
        // Ordered deliberately: the member already carries the rule by the time the repo is
        // touched, so a failed commit costs visibility, never the acceptance itself.
        const commit = await commitAcceptedRule({
          proposal,
          rule,
          memberName: asNonEmptyString(args?.memberName),
          worktreeId: asNonEmptyString(args?.worktreeId),
          requested: args?.commitToRepo !== false
        })
        return { ok: true as const, proposal, commit }
      })
    }
  )

  ipcMain.handle(
    ALICORN_IPC.ruleProposalsReject,
    async (_event, args: { id?: unknown }): Promise<RuleProposalDecisionResult> => {
      const id = asNonEmptyString(args?.id)
      if (!id) {
        return { ok: false, error: 'invalid_body' }
      }
      return attemptControlPlane(deps.client, async (client) => ({
        ok: true as const,
        proposal: await client.rejectRuleProposal(id),
        commit: { status: 'skipped' as const, reason: 'not_requested' as const }
      }))
    }
  )
}
