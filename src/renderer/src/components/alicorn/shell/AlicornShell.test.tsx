// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../../../../shared/alicorn/projects'
import type { PendingGateView } from '../../../../../shared/alicorn/gate-review'
import { useAppStore } from '@/store'
import { AlicornShell } from './AlicornShell'

const listProjects = vi.fn()
const listPendingGates = vi.fn()
// The org scope mounts the members pane, which reads the library on mount.
const listMembers = vi.fn()

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'prj_1',
    tenantId: 'local',
    name: 'Payments Platform',
    key: 'PAY',
    repoIds: ['repo-a'],
    createdBy: 'huy',
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    ...overrides
  }
}

function gate(repoId: string | null): PendingGateView {
  return {
    id: `gate-${repoId ?? 'none'}`,
    taskId: 't1',
    taskTitle: null,
    question: 'Merge?',
    options: ['yes'],
    createdAt: '2026-09-11T00:00:00.000Z',
    recommendation: null,
    policyEvaluated: false,
    autonomyLevel: null,
    repoId
  }
}

function seed(projects: Project[], gates: PendingGateView[] = []): void {
  listProjects.mockResolvedValue({ ok: true, projects })
  listPendingGates.mockResolvedValue({ ok: true, gates })
  listMembers.mockResolvedValue({ ok: true, members: [] })
  ;(window as unknown as { api: unknown }).api = {
    alicorn: { listProjects, listPendingGates, listMembers }
  }
}

beforeEach(() => {
  // The scope lives in the store, so a test that moves it would leak into the next one.
  useAppStore.getState().openAlicornPage('projects')
  listProjects.mockReset()
  listPendingGates.mockReset()
  listMembers.mockReset()
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('AlicornShell', () => {
  it('opens on the projects scope and lists what the control plane returned', async () => {
    seed([project()])
    render(<AlicornShell />)

    await waitFor(() => expect(screen.getAllByText('Payments Platform').length).toBeGreaterThan(0))
    expect(screen.getByText('1 running at once, one org library')).toBeInTheDocument()
  })

  // The defect this shell exists to fix: the org scope must not be able to show a project's name.
  it('drops every project name from the sidebar when the scope becomes the org', async () => {
    seed([project()])
    render(<AlicornShell />)
    await waitFor(() => expect(screen.getAllByText('Payments Platform').length).toBeGreaterThan(0))

    useAppStore.getState().openAlicornPage('org')

    await waitFor(() => expect(screen.queryByText('Payments Platform')).not.toBeInTheDocument())
    expect(screen.getByText('The library — nothing runs here')).toBeInTheDocument()
  })

  it('counts a project by the gates its repositories hold', async () => {
    seed([project()], [gate('repo-a'), gate('repo-a')])
    render(<AlicornShell />)

    await waitFor(() => expect(screen.getAllByText('Payments Platform').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('Payments Platform')[0]!)
    await waitFor(() => expect(screen.getByText('Waiting on you')).toBeInTheDocument())
    expect(screen.getByText('Waiting on you').parentElement).toHaveTextContent('2')
  })

  // A gate nothing places belongs to no project, so it must not inflate one.
  it('leaves an unattributed gate out of every project count', async () => {
    seed([project()], [gate(null)])
    render(<AlicornShell />)

    await waitFor(() => expect(screen.getAllByText('Payments Platform').length).toBeGreaterThan(0))
    const sidebarRow = screen.getAllByText('Payments Platform')[0]!
    fireEvent.click(sidebarRow)
    await waitFor(() => expect(screen.getByText('Waiting on you')).toBeInTheDocument())
    expect(screen.getByText('Waiting on you').parentElement).toHaveTextContent('0')
  })

  it('says the control plane is unreachable rather than showing an empty list', async () => {
    listProjects.mockResolvedValue({ ok: false, error: 'control_plane_unconfigured' })
    listPendingGates.mockResolvedValue({ ok: true, gates: [] })
    listMembers.mockResolvedValue({ ok: true, members: [] })
    ;(window as unknown as { api: unknown }).api = {
      alicorn: { listProjects, listPendingGates, listMembers }
    }
    render(<AlicornShell />)

    await waitFor(() =>
      expect(screen.getByText('The control plane is not reachable')).toBeInTheDocument()
    )
  })
})
