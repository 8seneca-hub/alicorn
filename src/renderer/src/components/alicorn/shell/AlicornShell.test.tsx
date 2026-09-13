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
// The task composer reads the org policy to plan a reviewer, and the board reads the project's
// tasks; an unstubbed call surfaces as an unhandled rejection rather than a test failure.
const getOrgPolicy = vi.fn()
const listTasks = vi.fn()

function project(overrides: Partial<Project> = {}): Project {
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
  getOrgPolicy.mockResolvedValue({ ok: true, policy: { enforceDistinctReviewerBackend: true } })
  listTasks.mockResolvedValue({ ok: true, tasks: [] })
  ;(window as unknown as { api: unknown }).api = {
    alicorn: { listProjects, listPendingGates, listMembers, getOrgPolicy, listTasks }
  }
}

/** Open the one seeded project and wait for the section it lands on. */
async function openProject(): Promise<void> {
  await waitFor(() => expect(screen.getAllByText('Payments Platform').length).toBeGreaterThan(0))
  fireEvent.click(screen.getAllByText('Payments Platform')[0]!)
  await waitFor(() => expect(screen.getByText('No tasks yet')).toBeInTheDocument())
}

/** The sidebar's Inbox row, whose trailing count is the project's waiting-gate figure. */
function sidebarInbox(): HTMLElement {
  return screen.getByText('Inbox').closest('button')!
}

beforeEach(() => {
  // The scope lives in the store, so a test that moves it would leak into the next one — and so
  // would a repo or an open modal a single test seeded.
  useAppStore.getState().openAlicornPage('projects')
  useAppStore.getState().closeModal()
  useAppStore.setState({ repos: [] })
  listProjects.mockReset()
  listPendingGates.mockReset()
  listMembers.mockReset()
  getOrgPolicy.mockReset()
  listTasks.mockReset()
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

    await openProject()
    expect(sidebarInbox().textContent).toBe('Inbox2')
  })

  // A gate nothing places belongs to no project, so it must not inflate one.
  it('leaves an unattributed gate out of every project count', async () => {
    seed([project()], [gate(null)])
    render(<AlicornShell />)

    await openProject()
    // No count at all, rather than a zero standing in for a gate this project does not own.
    expect(sidebarInbox().textContent).toBe('Inbox')
  })

  it('gives a project every section the sidebar promises, and a way back out', async () => {
    seed([project()])
    render(<AlicornShell />)

    await openProject()

    for (const label of [
      'Tasks',
      'Board',
      'Inbox',
      'Members',
      'Workflow',
      'Required Checks',
      'MCP Servers',
      'Settings'
      // Chat is deliberately absent: it is one session for the whole org, not one per project.
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }

    fireEvent.click(screen.getByText('All projects'))
    await waitFor(() =>
      expect(screen.getByText('1 running at once, one org library')).toBeInTheDocument()
    )
  })

  // A task is a ticket, not a workspace: New task must not open Alicorn's workspace composer.
  it('opens the task composer, and never the workspace composer', async () => {
    seed([project()])
    render(<AlicornShell />)

    await waitFor(() => expect(screen.getAllByText('Payments Platform').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('Payments Platform')[0]!)
    await waitFor(() => expect(screen.getAllByText('New task').length).toBeGreaterThan(0))

    fireEvent.click(screen.getAllByText('New task')[0]!)

    await waitFor(() =>
      expect(screen.getByText(/New task in Payments Platform/)).toBeInTheDocument()
    )
    expect(useAppStore.getState().activeModal).not.toBe('new-workspace-composer')
  })

  // Nothing has run, so the meter has nothing to state — and must not say $0.00.
  it('shows a dash for a project that has never cost anything', async () => {
    seed([project()])
    render(<AlicornShell />)

    await waitFor(() => expect(screen.getAllByText('Payments Platform').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('Payments Platform')[0]!)
    await waitFor(() => expect(screen.getByText('Project · — spent')).toBeInTheDocument())
  })

  it('says the control plane is unreachable rather than showing an empty list', async () => {
    listProjects.mockResolvedValue({ ok: false, error: 'control_plane_unconfigured' })
    listPendingGates.mockResolvedValue({ ok: true, gates: [] })
    listMembers.mockResolvedValue({ ok: true, members: [] })
    ;(window as unknown as { api: unknown }).api = {
      alicorn: { listProjects, listPendingGates, listMembers, getOrgPolicy, listTasks }
    }
    render(<AlicornShell />)

    await waitFor(() =>
      expect(screen.getByText('The control plane is not reachable')).toBeInTheDocument()
    )
  })
})
