// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n/i18n'
import { AlicornMembersPane } from './AlicornMembersPane'
import type { Member } from '../../../../shared/alicorn/members'

const listMembers = vi.fn()
const createMember = vi.fn()
const updateMember = vi.fn()
const deleteMember = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({ toast: { error: (message: string) => toastError(message) } }))

function member(overrides: Partial<Member>): Member {
  return {
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
    skills: [],
    ...overrides
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  listMembers.mockReset().mockResolvedValue({ ok: true, members: [] })
  createMember.mockReset().mockResolvedValue({ ok: true, member: member({}) })
  updateMember.mockReset().mockResolvedValue({ ok: true, member: member({}) })
  deleteMember.mockReset().mockResolvedValue({ ok: true })
  toastError.mockReset()
  ;(window as unknown as { api: unknown }).api = {
    // RB1 renders MemberRuleProposals inside the pane, which loads on mount. Without these the
    // load rejects unhandled — the suite still passes and the failure is invisible.
    alicorn: {
      listMembers,
      createMember,
      updateMember,
      deleteMember,
      listRuleProposals: vi.fn().mockResolvedValue({ ok: true, proposals: [] }),
      acceptRuleProposal: vi.fn().mockResolvedValue({ ok: true }),
      rejectRuleProposal: vi.fn().mockResolvedValue({ ok: true })
    }
  }
})

afterEach(cleanup)

describe('listing', () => {
  it('shows every member returned by the control plane', async () => {
    listMembers.mockResolvedValue({
      ok: true,
      members: [member({ id: 'm1', name: 'Builder' }), member({ id: 'm2', name: 'Reviewer' })]
    })

    render(<AlicornMembersPane />)

    expect(await screen.findByText('Builder')).toBeInTheDocument()
    expect(screen.getByText('Reviewer')).toBeInTheDocument()
  })

  it('explains an unconfigured control plane instead of showing an empty list', async () => {
    listMembers.mockResolvedValue({ ok: false, error: 'control_plane_unconfigured' })

    render(<AlicornMembersPane />)

    expect(await screen.findByText(/Control plane not configured/)).toBeInTheDocument()
    expect(screen.getByText(/ALICORN_CONTROL_API_URL/)).toBeInTheDocument()
  })

  it('surfaces any other read failure without claiming there are no members', async () => {
    listMembers.mockResolvedValue({ ok: false, error: 'not_a_member' })

    render(<AlicornMembersPane />)

    expect(await screen.findByText('not_a_member')).toBeInTheDocument()
    expect(screen.queryByText(/No members yet/)).not.toBeInTheDocument()
  })
})

describe('creating', () => {
  it('creates a member from the inline form', async () => {
    const user = userEvent.setup()
    render(<AlicornMembersPane />)
    await screen.findByText(/No members yet/)

    await user.click(screen.getByRole('button', { name: 'New member' }))
    await user.type(screen.getByLabelText('Name'), 'Reviewer')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createMember).toHaveBeenCalledTimes(1))
    expect(createMember).toHaveBeenCalledWith({
      name: 'Reviewer',
      role: 'developer',
      backend: 'claude',
      workspaceKind: 'worktree',
      permissionMode: 'accept_edits',
      systemRules: '',
      skills: []
    })
  })

  it('splits the comma-separated skills field into a list', async () => {
    const user = userEvent.setup()
    render(<AlicornMembersPane />)
    await screen.findByText(/No members yet/)

    await user.click(screen.getByRole('button', { name: 'New member' }))
    await user.type(screen.getByLabelText('Name'), 'Reviewer')
    await user.type(screen.getByLabelText('Skills'), 'code-review, security ,')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createMember).toHaveBeenCalled())
    // A trailing comma must not become an empty skill the server then rejects.
    expect(createMember.mock.calls[0]?.[0].skills).toEqual([
      { name: 'code-review', versionId: null },
      { name: 'security', versionId: null }
    ])
  })

  it('pins a catalog version from name@version', async () => {
    const user = userEvent.setup()
    render(<AlicornMembersPane />)
    await screen.findByText(/No members yet/)

    await user.click(screen.getByRole('button', { name: 'New member' }))
    await user.type(screen.getByLabelText('Name'), 'Reviewer')
    await user.type(screen.getByLabelText('Skills'), 'code-review@v3, security')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createMember).toHaveBeenCalled())
    expect(createMember.mock.calls[0]?.[0].skills).toEqual([
      { name: 'code-review', versionId: 'v3' },
      { name: 'security', versionId: null }
    ])
  })

  it('refuses to save a member with no name', async () => {
    const user = userEvent.setup()
    render(<AlicornMembersPane />)
    await screen.findByText(/No members yet/)

    await user.click(screen.getByRole('button', { name: 'New member' }))

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(createMember).not.toHaveBeenCalled()
  })

  it('reports a rejected create and keeps the form open', async () => {
    const user = userEvent.setup()
    createMember.mockResolvedValue({ ok: false, error: 'duplicate_name' })
    render(<AlicornMembersPane />)
    await screen.findByText(/No members yet/)

    await user.click(screen.getByRole('button', { name: 'New member' }))
    await user.type(screen.getByLabelText('Name'), 'Builder')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('duplicate_name'))
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })
})

describe('editing and deleting', () => {
  it('loads the existing member into the form', async () => {
    listMembers.mockResolvedValue({
      ok: true,
      members: [
        member({
          name: 'Builder',
          skills: [
            { name: 'a', versionId: null },
            { name: 'b', versionId: 'v2' }
          ]
        })
      ]
    })
    const user = userEvent.setup()
    render(<AlicornMembersPane />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(screen.getByLabelText('Name')).toHaveValue('Builder')
    expect(screen.getByLabelText('Skills')).toHaveValue('a, b@v2')
  })

  it('updates rather than creates when editing', async () => {
    listMembers.mockResolvedValue({ ok: true, members: [member({ id: 'm9', name: 'Builder' })] })
    const user = userEvent.setup()
    render(<AlicornMembersPane />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateMember).toHaveBeenCalled())
    expect(updateMember.mock.calls[0]?.[0]).toBe('m9')
    expect(createMember).not.toHaveBeenCalled()
  })

  it('deletes and reloads', async () => {
    listMembers.mockResolvedValue({ ok: true, members: [member({ id: 'm9' })] })
    const user = userEvent.setup()
    render(<AlicornMembersPane />)

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteMember).toHaveBeenCalledWith('m9'))
    expect(listMembers).toHaveBeenCalledTimes(2)
  })
})
