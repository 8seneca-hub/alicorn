// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { Project, ProjectInput } from '../../../../../shared/alicorn/projects'
import { AlicornNewProjectDialog, deriveProjectKey } from './AlicornNewProjectDialog'

function project(): Project {
  return {
    id: 'prj_1',
    tenantId: 'local',
    name: 'Payments Platform',
    key: 'PAY',
    context: '',
    source: null,
    repoIds: ['repo-a'],
    createdBy: 'huy',
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z'
  }
}

type CreateResult = { ok: true; project: Project } | { ok: false; error: string }

function renderDialog(
  overrides: { onCreate?: (input: ProjectInput) => Promise<CreateResult> } = {}
) {
  const onCreate = vi.fn<(input: ProjectInput) => Promise<CreateResult>>(
    overrides.onCreate ?? (async () => ({ ok: true, project: project() }))
  )
  const onCreated = vi.fn<(projectId: string) => void>()
  render(
    <AlicornNewProjectDialog
      open
      onOpenChange={vi.fn()}
      onCreate={onCreate}
      onCreated={onCreated}
    />
  )
  return { onCreate, onCreated }
}

function createButton(): HTMLButtonElement {
  return screen.getByText('Create project').closest('button')!
}

beforeEach(() => {
  useAppStore.setState({
    repos: [{ id: 'repo-a', path: '/a', displayName: 'repo-a', addedAt: 1 }] as never
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ repos: [] as never })
})

describe('creating a project', () => {
  it('derives the task key from the name until it is touched', () => {
    expect(deriveProjectKey('Payments Platform')).toBe('PAYM')
  })

  // A project with no repository has nowhere for its work to happen.
  it('refuses to create until a repository is chosen', () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Payments Platform' } })

    expect(createButton()).toBeDisabled()
  })

  it('creates once a repository is ticked', async () => {
    const { onCreate } = renderDialog()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Payments Platform' } })
    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(createButton()).not.toBeDisabled())
    fireEvent.click(createButton())

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Payments Platform', repoIds: ['repo-a'] })
      )
    )
  })

  it('says what the control plane refused rather than showing its error code', async () => {
    renderDialog({ onCreate: async () => ({ ok: false, error: 'project_requires_repo' }) })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Payments Platform' } })
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(createButton()).not.toBeDisabled())
    fireEvent.click(createButton())

    await waitFor(() =>
      expect(screen.getByText('A project needs at least one repository.')).toBeInTheDocument()
    )
  })
})
