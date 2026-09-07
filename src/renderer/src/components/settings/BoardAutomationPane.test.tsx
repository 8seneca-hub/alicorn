// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardAutomationPane } from './BoardAutomationPane'
import { useAppStore } from '@/store'
import type { BoardAutomationRule } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'

const listRules = vi.fn()
const saveRules = vi.fn()
const listMembers = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

const RULE: BoardAutomationRule = {
  id: 'rule-1',
  repoId: 'repo-1',
  toStatusId: 'in-review',
  memberId: 'member-1',
  promptTemplate: 'Review {{worktree}}.',
  enabled: true
}

const MEMBERS = [
  { id: 'member-1', name: 'Reviewer' },
  { id: 'member-2', name: 'Developer' }
]

function repo(id: string, displayName: string): Repo {
  return { id, path: `/tmp/${id}`, displayName, badgeColor: 'blue' } as Repo
}

function seed(repos: Repo[] = [repo('repo-1', 'First')]): void {
  useAppStore.setState({ repos } as never)
  ;(window as unknown as { api: unknown }).api = {
    boardAutomation: { listRules, saveRules },
    alicorn: { listMembers }
  }
}

describe('BoardAutomationPane', () => {
  beforeEach(() => {
    listRules.mockReset()
    saveRules.mockReset()
    listMembers.mockReset()
    toastError.mockReset()
    listRules.mockResolvedValue({ rules: [RULE] })
    saveRules.mockResolvedValue({ ok: true })
    listMembers.mockResolvedValue({ ok: true, members: MEMBERS })
    seed()
  })

  afterEach(() => {
    cleanup()
  })

  it('lists the rules for the project', async () => {
    render(<BoardAutomationPane />)

    await waitFor(() => expect(listRules).toHaveBeenCalledWith({ repoId: 'repo-1' }))
    expect(await screen.findByDisplayValue('Review {{worktree}}.')).toBeInTheDocument()
  })

  it('says so when the project has no rules yet', async () => {
    listRules.mockResolvedValue({ rules: [] })
    render(<BoardAutomationPane />)

    expect(await screen.findByText('No rules for this board yet.')).toBeInTheDocument()
  })

  // The safety claim: a rule that begins dispatching the moment it is typed gives nobody a chance
  // to read it back before it spends anything.
  it('creates a new rule disabled', async () => {
    listRules.mockResolvedValue({ rules: [] })
    render(<BoardAutomationPane />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add rule' }))

    await waitFor(() => expect(saveRules).toHaveBeenCalled())
    const saved = saveRules.mock.calls[0]![0] as { rules: BoardAutomationRule[] }
    expect(saved.rules).toHaveLength(1)
    expect(saved.rules[0]!.enabled).toBe(false)
  })

  // Why: a rule dispatches a Member, so offering an empty picker would create a rule that can
  // never run.
  it('cannot add a rule without a Member, and says why', async () => {
    listMembers.mockResolvedValue({ ok: true, members: [] })
    listRules.mockResolvedValue({ rules: [] })
    render(<BoardAutomationPane />)

    expect(await screen.findByRole('button', { name: 'Add rule' })).toBeDisabled()
    expect(screen.getByText('Create a Member first: a rule dispatches one.')).toBeInTheDocument()
  })

  // Why degrade rather than block: someone opening this pane in a hurry needs to read the rules and
  // switch them off, which does not require the control plane.
  it('still lists and disables rules when the control plane is unreachable', async () => {
    listMembers.mockResolvedValue({ ok: false, error: 'control_plane_unconfigured' })
    render(<BoardAutomationPane />)

    expect(await screen.findByDisplayValue('Review {{worktree}}.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(saveRules).toHaveBeenCalled())
    const saved = saveRules.mock.calls[0]![0] as { rules: BoardAutomationRule[] }
    expect(saved.rules[0]!.enabled).toBe(false)
  })

  it('saves the edited rule against its own project', async () => {
    render(<BoardAutomationPane />)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(saveRules).toHaveBeenCalledWith({ repoId: 'repo-1', rules: [] }))
  })

  // Why roll back: the pane writes optimistically so the switch feels immediate, which means a
  // refused save must not leave the UI claiming something was persisted.
  it('rolls back and reports when a save is refused', async () => {
    saveRules.mockResolvedValue({ ok: false })
    render(<BoardAutomationPane />)

    await userEvent.click(await screen.findByRole('switch'))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(await screen.findByRole('switch')).toBeChecked()
  })

  it('offers a project picker only when there is more than one project', async () => {
    render(<BoardAutomationPane />)
    await screen.findByDisplayValue('Review {{worktree}}.')
    expect(screen.queryByText('Project')).not.toBeInTheDocument()

    cleanup()
    seed([repo('repo-1', 'First'), repo('repo-2', 'Second')])
    render(<BoardAutomationPane />)

    expect(await screen.findByText('Project')).toBeInTheDocument()
  })

  it('reads the rules of whichever project is selected', async () => {
    seed([repo('repo-1', 'First'), repo('repo-2', 'Second')])
    render(<BoardAutomationPane />)
    await screen.findByText('Project')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'repo-2')

    await waitFor(() => expect(listRules).toHaveBeenCalledWith({ repoId: 'repo-2' }))
  })

  // Why assert the names: without them the three selects are indistinguishable to a screen reader,
  // and the rule editor is exactly where guessing which dropdown you are on is expensive.
  it('names every control for assistive technology', async () => {
    render(<BoardAutomationPane />)
    await screen.findByDisplayValue('Review {{worktree}}.')

    expect(screen.getByRole('combobox', { name: 'Column' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Member' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable rule' })).toBeInTheDocument()
  })

  // Why: rules are per board, so with no project there is nothing to configure and the pane says
  // that rather than rendering an editor that cannot save.
  it('asks for a project when none exists', async () => {
    seed([])
    render(<BoardAutomationPane />)

    expect(
      await screen.findByText('Add a project first: automation rules are configured per board.')
    ).toBeInTheDocument()
    expect(saveRules).not.toHaveBeenCalled()
  })
})
