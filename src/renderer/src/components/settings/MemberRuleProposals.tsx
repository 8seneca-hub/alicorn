import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Member } from '../../../../shared/alicorn/members'
import type { RuleProposal, RulebookCommitResult } from '../../../../shared/alicorn/rule-proposals'
import { RULE_TEXT_MAX_CHARS } from '../../../../shared/alicorn/rule-proposals'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Textarea } from '../ui/textarea'
import { translate } from '@/i18n/i18n'
import { useActiveWorktreeId } from '../../store/selectors'

type Deciding = { id: string; action: 'accept' | 'reject' } | null

/** Why a short sha: the full 40 is noise in a settings row, and the excerpt below carries the diff. */
function shortSha(sha: string | undefined): string | null {
  return sha ? sha.slice(0, 8) : null
}

function describeCommit(commit: RulebookCommitResult): string {
  if (commit.status === 'committed') {
    return translate(
      'auto.components.settings.memberRuleProposals.committed',
      'Committed {{path}}',
      {
        path: commit.filePath
      }
    )
  }
  switch (commit.reason) {
    case 'not_requested':
      return translate(
        'auto.components.settings.memberRuleProposals.skipNotRequested',
        'Rule saved on the member. Not committed to a repository.'
      )
    case 'no_origin_workspace':
      return translate(
        'auto.components.settings.memberRuleProposals.skipNoWorkspace',
        'Rule saved on the member. No open workspace to commit it to.'
      )
    case 'remote_workspace':
      return translate(
        'auto.components.settings.memberRuleProposals.skipRemote',
        'Rule saved on the member. A workspace on an SSH host is not committed to from here.'
      )
    case 'not_a_git_repository':
      return translate(
        'auto.components.settings.memberRuleProposals.skipNotGit',
        'Rule saved on the member. This workspace is a folder, not a repository.'
      )
    case 'dirty_worktree':
      return translate(
        'auto.components.settings.memberRuleProposals.skipDirty',
        'Rule saved on the member. Commit or stash your changes, then it can be committed.'
      )
    case 'commit_failed':
      return translate(
        'auto.components.settings.memberRuleProposals.skipFailed',
        'Rule saved on the member, but the commit failed: {{message}}',
        { message: commit.message ?? '' }
      )
  }
}

/**
 * RB1. A correction a human already paid for by hand, offered back as a standing rule on the member
 * that caused it. The rule text is written here, by a person — a member never proposes and accepts
 * its own constraint, and a rule only ever adds one.
 */
export function MemberRuleProposals({
  member,
  onAccepted
}: {
  member: Member
  onAccepted: () => void
}): React.JSX.Element | null {
  const [proposals, setProposals] = useState<RuleProposal[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [commitToRepo, setCommitToRepo] = useState(true)
  const [deciding, setDeciding] = useState<Deciding>(null)
  const worktreeId = useActiveWorktreeId()

  const load = useCallback(async () => {
    const result = await window.api.alicorn.listRuleProposals({
      memberId: member.id,
      status: 'pending'
    })
    // A pane that cannot read proposals still lists members; this section just stays hidden.
    setProposals(result.ok ? result.proposals : [])
  }, [member.id])

  useEffect(() => {
    void load()
  }, [load])

  const decide = useCallback(
    async (proposal: RuleProposal, action: 'accept' | 'reject') => {
      const rule = (drafts[proposal.id] ?? '').trim()
      if (action === 'accept' && !rule) {
        return
      }
      setDeciding({ id: proposal.id, action })
      const result =
        action === 'accept'
          ? await window.api.alicorn.acceptRuleProposal({
              id: proposal.id,
              rule,
              memberName: member.name,
              worktreeId: worktreeId ?? null,
              commitToRepo
            })
          : await window.api.alicorn.rejectRuleProposal({ id: proposal.id })
      setDeciding(null)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (action === 'accept') {
        toast.success(describeCommit(result.commit))
        onAccepted()
      }
      await load()
    },
    [commitToRepo, drafts, load, member.name, onAccepted, worktreeId]
  )

  if (proposals.length === 0) {
    return null
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium text-foreground">
        {translate(
          'auto.components.settings.memberRuleProposals.title',
          'Proposed rules from corrections'
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.memberRuleProposals.description',
          'A human amended or reverted this member’s work. Write the rule that would have prevented it.'
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.memberRuleProposals.alsoBriefedToLead',
          'An accepted rule briefs this member on every dispatch, and is also briefed to the Foreman lead that may dispatch it.'
        )}
      </p>

      {proposals.map((proposal) => {
        const sha = shortSha(proposal.context.sha)
        const files = proposal.context.files ?? []
        const busy = deciding?.id === proposal.id
        return (
          <div key={proposal.id} className="space-y-2 border-t border-border pt-2">
            <p className="text-xs text-muted-foreground">
              {proposal.verdict === 'rejected'
                ? translate(
                    'auto.components.settings.memberRuleProposals.verdictRejected',
                    'Reverted'
                  )
                : translate(
                    'auto.components.settings.memberRuleProposals.verdictAmended',
                    'Amended'
                  )}
              {sha ? ` · ${sha}` : ''}
              {files.length > 0 ? ` · ${files.slice(0, 3).join(', ')}` : ''}
              {files.length > 3
                ? ` ${translate('auto.components.settings.memberRuleProposals.moreFiles', 'and {{count}} more', { count: files.length - 3 })}`
                : ''}
            </p>

            {proposal.context.excerpt ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {translate('auto.components.settings.memberRuleProposals.showDiff', 'Show diff')}
                </summary>
                <pre className="scrollbar-sleek mt-1 max-h-48 overflow-auto rounded bg-background p-2 text-[11px] leading-tight">
                  {proposal.context.excerpt}
                </pre>
              </details>
            ) : null}

            <Textarea
              value={drafts[proposal.id] ?? ''}
              maxLength={RULE_TEXT_MAX_CHARS}
              aria-label={translate(
                'auto.components.settings.memberRuleProposals.ruleLabel',
                'Rule to add to this member'
              )}
              placeholder={translate(
                'auto.components.settings.memberRuleProposals.rulePlaceholder',
                'Always run the migration before changing the schema type.'
              )}
              className="h-16 w-full text-xs"
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [proposal.id]: event.target.value }))
              }
            />

            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={commitToRepo}
                  onCheckedChange={(checked) => setCommitToRepo(checked === true)}
                />
                {translate(
                  'auto.components.settings.memberRuleProposals.commitToRepo',
                  'Also commit to the repository'
                )}
              </label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void decide(proposal, 'reject')}
                >
                  {translate('auto.components.settings.memberRuleProposals.reject', 'Dismiss')}
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !(drafts[proposal.id] ?? '').trim()}
                  onClick={() => void decide(proposal, 'accept')}
                >
                  {translate('auto.components.settings.memberRuleProposals.accept', 'Accept rule')}
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
