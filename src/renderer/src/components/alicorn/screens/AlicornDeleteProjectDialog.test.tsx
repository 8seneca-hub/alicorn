// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../../../../shared/alicorn/projects'
import { AlicornDeleteProjectDialog } from './AlicornDeleteProjectDialog'

function project(): Project {
  return {
    id: 'prj_1',
    tenantId: 'local',
    name: 'Payments Platform',
    key: 'PAY',
    repoIds: ['repo-a'],
    createdBy: 'huy',
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z'
  }
}

function renderDialog(openTaskCount = 0) {
  const onDelete = vi.fn(async () => ({ ok: true as const }))
  const onDeleted = vi.fn()
  render(
    <AlicornDeleteProjectDialog
      project={project()}
      openTaskCount={openTaskCount}
      onOpenChange={vi.fn()}
      onDelete={onDelete}
      onDeleted={onDeleted}
    />
  )
  return { onDelete, onDeleted }
}

const deleteButton = (): HTMLButtonElement => screen.getByText('Delete project').closest('button')!

afterEach(cleanup)

describe('deleting a project', () => {
  // A project holds every ticket in it; a misplaced click must not be able to spend them.
  it('will not delete until the name is typed', () => {
    renderDialog()

    expect(deleteButton()).toBeDisabled()
  })

  it('deletes once the name matches', async () => {
    const { onDelete, onDeleted } = renderDialog()

    fireEvent.change(screen.getByLabelText(/Type Payments Platform to confirm/), {
      target: { value: 'Payments Platform' }
    })
    await waitFor(() => expect(deleteButton()).not.toBeDisabled())
    fireEvent.click(deleteButton())

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('prj_1'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })

  it('rejects a near-miss', () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText(/Type Payments Platform to confirm/), {
      target: { value: 'payments platform' }
    })

    expect(deleteButton()).toBeDisabled()
  })

  // What is at stake is the board, and the count is the part someone reads.
  it('says how much open work goes with it', () => {
    renderDialog(3)

    expect(screen.getByText('3 tasks are still open. They go too.')).toBeInTheDocument()
  })

  it('says nothing about open work when there is none', () => {
    renderDialog(0)

    expect(screen.queryByText(/still open/)).not.toBeInTheDocument()
  })

  it('keeps the dialog open and shows why when the control plane refuses', async () => {
    const onDelete = vi.fn(async () => ({ ok: false as const, error: 'not_found' }))
    const onDeleted = vi.fn()
    render(
      <AlicornDeleteProjectDialog
        project={project()}
        openTaskCount={0}
        onOpenChange={vi.fn()}
        onDelete={onDelete}
        onDeleted={onDeleted}
      />
    )

    fireEvent.change(screen.getAllByLabelText(/Type Payments Platform to confirm/)[0]!, {
      target: { value: 'Payments Platform' }
    })
    await waitFor(() => expect(screen.getAllByText('Delete project')[0]).toBeTruthy())
    fireEvent.click(screen.getAllByText('Delete project').at(-1)!.closest('button')!)

    await waitFor(() => expect(screen.getByText('not_found')).toBeInTheDocument())
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
