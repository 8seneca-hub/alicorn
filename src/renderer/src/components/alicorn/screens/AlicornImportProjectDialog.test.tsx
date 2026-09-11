// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { Project } from '../../../../../shared/alicorn/projects'
import { AlicornImportProjectDialog } from './AlicornImportProjectDialog'

const status = vi.fn()
const listProjects = vi.fn()
const listIssues = vi.fn()
const listStates = vi.fn()
const createTask = vi.fn()

function project(): Project {
  return {
    id: 'prj_1',
    tenantId: 'local',
    name: 'Payments Platform',
    key: 'ALC',
    repoIds: ['repo-a'],
    createdBy: 'huy',
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z'
  }
}

function issue(readableId: string, stateId: string) {
  return {
    id: `uuid-${readableId}`,
    sequenceId: 1,
    readableId,
    name: `Issue ${readableId}`,
    descriptionHtml: '<p>body</p>',
    priority: 'none',
    stateId,
    projectId: 'plane-1',
    assigneeIds: [],
    labelIds: [],
    parentId: null,
    startDate: null,
    targetDate: null
  }
}

beforeEach(() => {
  status.mockReset()
  listProjects.mockReset()
  listIssues.mockReset()
  listStates.mockReset()
  createTask.mockReset()
  status.mockResolvedValue({ connected: true, viewer: null })
  listProjects.mockResolvedValue({
    ok: true,
    value: [{ id: 'plane-1', identifier: 'ALC', name: 'Alicorn Platform' }]
  })
  listIssues.mockResolvedValue({
    ok: true,
    value: [issue('ALC-1', 'st-open'), issue('ALC-2', 'st-done')]
  })
  listStates.mockResolvedValue({
    ok: true,
    value: [
      { id: 'st-open', group: 'started' },
      { id: 'st-done', group: 'completed' }
    ]
  })
  createTask.mockResolvedValue({ ok: true, task: {} })
  ;(window as unknown as { api: unknown }).api = {
    plane: { status, listProjects, listIssues, listStates },
    alicorn: { createTask }
  }
  useAppStore.setState({
    repos: [{ id: 'repo-a', path: '/a', displayName: 'repo-a', addedAt: 1 }] as never
  })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
  useAppStore.setState({ repos: [] as never })
})

function renderDialog(onCreate = vi.fn(async () => ({ ok: true as const, project: project() }))) {
  const onImported = vi.fn<(projectId: string) => void>()
  render(
    <AlicornImportProjectDialog
      open
      onOpenChange={vi.fn()}
      onCreate={onCreate}
      onImported={onImported}
    />
  )
  return { onCreate, onImported }
}

describe('importing a project from a PM tool', () => {
  it('sends you to Settings when nothing is connected, rather than an empty list', async () => {
    status.mockResolvedValue({ connected: false, viewer: null })
    renderDialog()

    await waitFor(() => expect(screen.getByText('No PM tool is connected')).toBeInTheDocument())
  })

  it('fills the name and key from the board, since Plane’s identifier is already a key', async () => {
    renderDialog()

    await waitFor(() => expect(screen.getByText('Alicorn Platform')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Alicorn Platform'))

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Alicorn Platform'))
    expect(screen.getByLabelText('Task key')).toHaveValue('ALC')
  })

  // The number is the decision at project level, so it has to be the truth.
  it('previews only the issues still open', async () => {
    renderDialog()

    await waitFor(() => expect(screen.getByText('Alicorn Platform')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Alicorn Platform'))

    await waitFor(() =>
      expect(screen.getByText('Creates Alicorn Platform (ALC) with 1 tasks.')).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /Only issues still open/ }))
    await waitFor(() =>
      expect(screen.getByText('Creates Alicorn Platform (ALC) with 2 tasks.')).toBeInTheDocument()
    )
  })

  it('will not import without a repository, like any other project', async () => {
    renderDialog()

    await waitFor(() => expect(screen.getByText('Alicorn Platform')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Alicorn Platform'))
    await waitFor(() => expect(screen.getByLabelText('Task key')).toHaveValue('ALC'))

    expect(screen.getByText('Import project').closest('button')).toBeDisabled()
  })

  it('creates the project, then one task per issue carrying its reference back', async () => {
    const { onCreate, onImported } = renderDialog()

    await waitFor(() => expect(screen.getByText('Alicorn Platform')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Alicorn Platform'))
    await waitFor(() => expect(screen.getByLabelText('Task key')).toHaveValue('ALC'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'repo-a' }))

    const importButton = screen.getByText('Import project').closest('button')!
    await waitFor(() => expect(importButton).not.toBeDisabled())
    fireEvent.click(importButton)

    await waitFor(() => expect(onImported).toHaveBeenCalledWith('prj_1'))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alicorn Platform', key: 'ALC', repoIds: ['repo-a'] })
    )
    expect(createTask).toHaveBeenCalledTimes(1)
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'prj_1',
        title: 'Issue ALC-1',
        source: expect.objectContaining({ provider: 'plane', ref: 'ALC-1' })
      })
    )
  })
})
