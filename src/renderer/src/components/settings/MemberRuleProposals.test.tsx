// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n/i18n'
import { MemberRuleProposals } from './MemberRuleProposals'
import type { Member } from '../../../../shared/alicorn/members'
import type { RuleProposal } from '../../../../shared/alicorn/rule-proposals'

const listRuleProposals = vi.fn()
const acceptRuleProposal = vi.fn()
const rejectRuleProposal = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message)
  }
}))

vi.mock('../../store/selectors', () => ({ useActiveWorktreeId: () => 'w1' }))

const MEMBER: Member = {
  id: 'm1',
  tenantId: 'local',
  createdBy: 'actor',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  name: 'Builder',
  role: 'developer',
  backend: 'claude',
  workspaceKind: 'worktree',
  permissionMode: 'accept_edits',
  systemRules: '',
  skills: []
}

function proposal(overrides: Partial<RuleProposal> = {}): RuleProposal {
  return {
    id: 'p1',
    tenantId: 'local',
    memberId: 'm1',
    outcomeId: 'o1',
    verdict: 'amended',
    context: { sha: 'abc12345def', files: ['src/a.ts'], excerpt: 'diff --git a/src/a.ts' },
    proposedRule: null,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-09-08T00:00:00.000Z',
    ...overrides
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  listRuleProposals.mockReset().mockResolvedValue({ ok: true, proposals: [proposal()] })
  acceptRuleProposal
    .mockReset()
    .mockResolvedValue({
      ok: true,
      proposal: proposal({ status: 'accepted' }),
      commit: { status: 'committed', filePath: '.alicorn/rules/builder-m1.md' }
    })
  rejectRuleProposal
    .mockReset()
    .mockResolvedValue({ ok: true, proposal: proposal({ status: 'rejected' }) })
  toastError.mockReset()
  toastSuccess.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    alicorn: { listRuleProposals, acceptRuleProposal, rejectRuleProposal }
  }
})

afterEach(cleanup)

describe('showing a proposal', () => {
  it('reads only this member’s pending proposals', async () => {
    render(<MemberRuleProposals member={MEMBER} onAccepted={vi.fn()} />)

    await waitFor(() =>
      expect(listRuleProposals).toHaveBeenCalledWith({ memberId: 'm1', status: 'pending' })
    )
    expect(await screen.findByText(/Amended/)).toBeInTheDocument()
    expect(screen.getByText(/abc12345/)).toBeInTheDocument()
  })

  it('renders nothing at all when the member has no proposals', async () => {
    listRuleProposals.mockResolvedValue({ ok: true, proposals: [] })

    const { container } = render(<MemberRuleProposals member={MEMBER} onAccepted={vi.fn()} />)

    await waitFor(() => expect(listRuleProposals).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  // A pane that cannot reach the control plane still lists members; this section just hides.
  it('stays hidden when the proposals cannot be read', async () => {
    listRuleProposals.mockResolvedValue({ ok: false, error: 'control_plane_unconfigured' })

    const { container } = render(<MemberRuleProposals member={MEMBER} onAccepted={vi.fn()} />)

    await waitFor(() => expect(listRuleProposals).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('accepting', () => {
  it('cannot accept until a human has written the rule', async () => {
    render(<MemberRuleProposals member={MEMBER} onAccepted={vi.fn()} />)

    const accept = await screen.findByRole('button', { name: 'Accept rule' })
    expect(accept).toBeDisabled()
    expect(acceptRuleProposal).not.toHaveBeenCalled()
  })

  it('sends the rule the human wrote, with the active workspace to commit into', async () => {
    const onAccepted = vi.fn()
    render(<MemberRuleProposals member={MEMBER} onAccepted={onAccepted} />)

    await userEvent.type(
      await screen.findByLabelText('Rule to add to this member'),
      'Always run the migration first.'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Accept rule' }))

    await waitFor(() =>
      expect(acceptRuleProposal).toHaveBeenCalledWith({
        id: 'p1',
        rule: 'Always run the migration first.',
        memberName: 'Builder',
        worktreeId: 'w1',
        commitToRepo: true
      })
    )
    expect(toastSuccess).toHaveBeenCalledWith('Committed .alicorn/rules/builder-m1.md')
    // The member's system rules changed server-side, so the pane has to re-read.
    expect(onAccepted).toHaveBeenCalled()
  })

  it('says the rule was saved even when the repo commit was skipped', async () => {
    acceptRuleProposal.mockResolvedValue({
      ok: true,
      proposal: proposal({ status: 'accepted' }),
      commit: { status: 'skipped', reason: 'dirty_worktree' }
    })
    render(<MemberRuleProposals member={MEMBER} onAccepted={vi.fn()} />)

    await userEvent.type(await screen.findByLabelText('Rule to add to this member'), 'A rule.')
    await userEvent.click(screen.getByRole('button', { name: 'Accept rule' }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Rule saved on the member. Commit or stash your changes, then it can be committed.'
      )
    )
  })

  it('leaves the commit out when the human unchecks it', async () => {
    render(<MemberRuleProposals member={MEMBER} onAccepted={vi.fn()} />)

    await userEvent.type(await screen.findByLabelText('Rule to add to this member'), 'A rule.')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Accept rule' }))

    await waitFor(() =>
      expect(acceptRuleProposal).toHaveBeenCalledWith(
        expect.objectContaining({ commitToRepo: false })
      )
    )
  })

  it('reports a refusal from the control plane', async () => {
    acceptRuleProposal.mockResolvedValue({ ok: false, error: 'not_pending' })
    render(<MemberRuleProposals member={MEMBER} onAccepted={vi.fn()} />)

    await userEvent.type(await screen.findByLabelText('Rule to add to this member'), 'A rule.')
    await userEvent.click(screen.getByRole('button', { name: 'Accept rule' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('not_pending'))
  })
})

describe('dismissing', () => {
  it('rejects without asking for rule text', async () => {
    render(<MemberRuleProposals member={MEMBER} onAccepted={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(rejectRuleProposal).toHaveBeenCalledWith({ id: 'p1' }))
    expect(acceptRuleProposal).not.toHaveBeenCalled()
  })
})
