// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Member, MemberBackend, MemberRole } from '../../../../shared/alicorn/members'
import { useComposerTaskPlan } from '@/hooks/use-composer-task-plan'
import { NewWorkspaceComposerContextSection } from './NewWorkspaceComposerContextSection'

const listMembers = vi.fn()
const getOrgPolicy = vi.fn()

function member(id: string, role: MemberRole, backend: MemberBackend, name = id): Member {
  return {
    id,
    name,
    role,
    backend,
    workspaceKind: 'worktree',
    permissionMode: 'ask',
    systemRules: '',
    skills: [],
    tenantId: 'local',
    createdBy: 'test',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z'
  }
}

function seed(members: Member[], enforceDistinctReviewerBackend = true): void {
  listMembers.mockResolvedValue({ ok: true, members })
  getOrgPolicy.mockResolvedValue({ ok: true, policy: { enforceDistinctReviewerBackend } })
  ;(window as unknown as { api: unknown }).api = { alicorn: { listMembers, getOrgPolicy } }
}

const REPOS = [{ id: 'r1', name: 'payments-service' }]

function Harness({ note = 'Partial refunds write their own ledger entry.' }: { note?: string }) {
  const taskPlan = useComposerTaskPlan({
    title: 'Partial refunds in payments',
    brief: note,
    repos: REPOS,
    openRepoId: 'r1'
  })
  return (
    <NewWorkspaceComposerContextSection
      note={note}
      onNoteChange={() => {}}
      taskPlan={taskPlan}
      repoName={(id) => REPOS.find((repo) => repo.id === id)?.name ?? id}
    />
  )
}

beforeEach(() => {
  listMembers.mockReset()
  getOrgPolicy.mockReset()
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('NewWorkspaceComposerContextSection', () => {
  it('states who builds and who reviews, and why the reviewer differs', async () => {
    seed([member('dev', 'developer', 'claude', 'Dev'), member('qa', 'reviewer', 'grok', 'QA')])
    render(<Harness />)

    await waitFor(() => expect(screen.getByTestId('composer-task-plan')).toBeInTheDocument())
    expect(screen.getByTestId('composer-task-plan')).toHaveTextContent('Dev builds it')
    expect(screen.getByTestId('composer-task-plan')).toHaveTextContent(
      'QA reviews on grok, a different backend from the author'
    )
    expect(screen.getByTestId('composer-task-plan')).toHaveTextContent(
      'Matched payments-service from what you wrote'
    )
  })

  // The whole point of surfacing the plan: the case that would gate has to be visible first.
  it('says so when every reviewer shares the author backend', async () => {
    seed([member('dev', 'developer', 'claude', 'Dev'), member('qa', 'reviewer', 'claude', 'QA')])
    render(<Harness />)

    await waitFor(() =>
      expect(screen.getByTestId('composer-task-plan')).toHaveTextContent('gates at review')
    )
  })

  it('says it has stopped adjusting once pinned, and offers the plan back', () => {
    const unpin = vi.fn()
    const dev = member('dev', 'developer', 'claude', 'Dev')
    render(
      <NewWorkspaceComposerContextSection
        note="anything"
        onNoteChange={() => {}}
        repoName={(id) => id}
        taskPlan={{
          available: true,
          members: [dev],
          plan: {
            authorId: 'dev',
            reviewerId: null,
            repoIds: ['r1'],
            reasons: [{ kind: 'author_defaulted', memberId: 'dev' }],
            reviewerConflict: false
          },
          pinned: true,
          authorId: 'dev',
          reviewerId: null,
          setAuthorId: () => {},
          setReviewerId: () => {},
          unpin,
          memberName: () => 'Dev'
        }}
      />
    )

    expect(screen.getByText(/stopped adjusting/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Let it decide again'))
    expect(unpin).toHaveBeenCalledOnce()
  })

  // A host without the control plane still has to get a working composer.
  it('renders the context field and no plan when there are no members', async () => {
    seed([])
    render(<Harness />)

    await waitFor(() => expect(screen.getByLabelText('Context')).toBeInTheDocument())
    expect(screen.queryByTestId('composer-task-plan')).not.toBeInTheDocument()
  })

  it('renders the context field when the alicorn bridge is absent entirely', async () => {
    ;(window as unknown as { api?: unknown }).api = {}
    render(<Harness />)

    await waitFor(() => expect(screen.getByLabelText('Context')).toBeInTheDocument())
    expect(screen.queryByTestId('composer-task-plan')).not.toBeInTheDocument()
  })
})
