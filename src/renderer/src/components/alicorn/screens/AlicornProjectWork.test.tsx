// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../../../shared/alicorn/tasks'
import { AlicornProjectBoard, AlicornProjectTasks } from './AlicornProjectWork'
import type { ProjectTasksState } from './use-project-tasks'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_1',
    tenantId: 'local',
    projectId: 'prj_1',
    number: 142,
    title: 'Refund API — partial refunds',
    context: '',
    column: 'todo',
    executionStrategy: 'single',
    workflowId: null,
    stageKey: null,
    memberIds: [],
    source: null,
    createdBy: 'huy',
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    closedAt: null,
    ...overrides
  }
}

function state(overrides: Partial<ProjectTasksState> = {}): ProjectTasksState {
  return {
    tasks: [task()],
    error: null,
    loading: false,
    reload: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    ...overrides
  }
}

function props(overrides: Partial<Parameters<typeof AlicornProjectBoard>[0]> = {}) {
  return {
    projectName: 'Payments Platform',
    projectKey: 'PAY',
    state: state(),
    onAllProjects: vi.fn(),
    onNewTask: vi.fn(),
    onOpenTask: vi.fn(),
    onSwitchView: vi.fn(),
    ...overrides
  }
}

afterEach(cleanup)

describe('the board', () => {
  it('shows a task by its project-prefixed id, not a repository name', () => {
    render(<AlicornProjectBoard {...props()} />)

    expect(screen.getByText('PAY-142')).toBeInTheDocument()
    expect(screen.getByText('Refund API — partial refunds')).toBeInTheDocument()
  })

  it('moves a card to the column it was dropped on', () => {
    const update = vi.fn()
    render(<AlicornProjectBoard {...props({ state: state({ update }) })} />)

    fireEvent.dragStart(screen.getByText('PAY-142'))
    const target = screen.getByText('In progress').closest('section')!
    fireEvent.dragOver(target)
    fireEvent.drop(target)

    expect(update).toHaveBeenCalledWith('tsk_1', { column: 'in-progress' })
  })

  it('does not write when a card is dropped back where it started', () => {
    const update = vi.fn()
    render(<AlicornProjectBoard {...props({ state: state({ update }) })} />)

    fireEvent.dragStart(screen.getByText('PAY-142'))
    const target = screen.getByText('Todo').closest('section')!
    fireEvent.drop(target)

    expect(update).not.toHaveBeenCalled()
  })

  it('opens a task when its card is clicked', () => {
    const onOpenTask = vi.fn()
    render(<AlicornProjectBoard {...props({ onOpenTask })} />)

    fireEvent.click(screen.getByText('Refund API — partial refunds'))

    expect(onOpenTask).toHaveBeenCalledWith('tsk_1')
  })

  it('says the control plane refused rather than drawing an empty board', () => {
    render(
      <AlicornProjectBoard
        {...props({ state: state({ error: 'control_plane_unconfigured', tasks: [] }) })}
      />
    )

    expect(screen.getByText('Tasks could not be read')).toBeInTheDocument()
  })
})

describe('the task list', () => {
  it('lists the task with its id, column and strategy', () => {
    render(<AlicornProjectTasks {...props()} />)

    expect(screen.getByText('PAY-142')).toBeInTheDocument()
    expect(screen.getByText('Todo')).toBeInTheDocument()
    expect(screen.getByText('single')).toBeInTheDocument()
  })

  it('offers a first task rather than an empty table', () => {
    const onNewTask = vi.fn()
    render(<AlicornProjectTasks {...props({ state: state({ tasks: [] }), onNewTask })} />)

    expect(screen.getByText('No tasks yet')).toBeInTheDocument()
    // Both the header and the empty state offer one; the empty state's is the last.
    fireEvent.click(screen.getAllByText('New task').at(-1)!)
    expect(onNewTask).toHaveBeenCalled()
  })
})
