// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../../../shared/alicorn/tasks'
import { useProjectTasks } from './use-project-tasks'

const listTasks = vi.fn()
const createTask = vi.fn()
const updateTask = vi.fn()

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_1',
    tenantId: 'local',
    projectId: 'prj_1',
    number: 1,
    title: 'Refund API',
    context: '',
    column: 'todo',
    executionStrategy: 'single',
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

beforeEach(() => {
  listTasks.mockReset()
  createTask.mockReset()
  updateTask.mockReset()
  listTasks.mockResolvedValue({ ok: true, tasks: [task()] })
  ;(window as unknown as { api: unknown }).api = {
    alicorn: { listTasks, createTask, updateTask }
  }
})

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('useProjectTasks', () => {
  it('reads the project’s tasks', async () => {
    const { result } = renderHook(() => useProjectTasks('prj_1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(listTasks).toHaveBeenCalledWith('prj_1')
    expect(result.current.tasks).toHaveLength(1)
  })

  it('says the control plane refused rather than showing an empty board', async () => {
    listTasks.mockResolvedValue({ ok: false, error: 'control_plane_unconfigured' })
    const { result } = renderHook(() => useProjectTasks('prj_1'))

    await waitFor(() => expect(result.current.error).toBe('control_plane_unconfigured'))
    expect(result.current.tasks).toEqual([])
  })

  it('puts a created task at the top, matching the server’s newest-first order', async () => {
    createTask.mockResolvedValue({ ok: true, task: task({ id: 'tsk_2', number: 2 }) })
    const { result } = renderHook(() => useProjectTasks('prj_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.create({
        title: 'Webhook retries',
        context: '',
        column: 'todo',
        executionStrategy: 'single',
        stageKey: null,
        memberIds: [],
        source: null
      })
    })

    expect(result.current.tasks.map((row) => row.id)).toEqual(['tsk_2', 'tsk_1'])
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'prj_1' }))
  })

  // The card has to move under the cursor, not after a round trip.
  it('moves a card before the write lands', async () => {
    let settle: (value: unknown) => void = () => {}
    updateTask.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    const { result } = renderHook(() => useProjectTasks('prj_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let pending: Promise<unknown> | undefined
    act(() => {
      pending = result.current.update('tsk_1', { column: 'in-progress' })
    })
    expect(result.current.tasks[0]?.column).toBe('in-progress')

    await act(async () => {
      settle({ ok: true, task: task({ column: 'in-progress' }) })
      await pending
    })
    expect(result.current.tasks[0]?.column).toBe('in-progress')
  })

  it('puts the card back when the write is refused', async () => {
    updateTask.mockResolvedValue({ ok: false, error: 'not_found' })
    const { result } = renderHook(() => useProjectTasks('prj_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.update('tsk_1', { column: 'completed' })
    })

    expect(result.current.tasks[0]?.column).toBe('todo')
  })

  it('degrades to unreachable when the host has no alicorn bridge', async () => {
    delete (window as unknown as { api?: unknown }).api
    const { result } = renderHook(() => useProjectTasks('prj_1'))

    await waitFor(() => expect(result.current.error).toBe('control_plane_unreachable'))
    await act(async () => {
      const created = await result.current.create({
        title: 'x',
        context: '',
        column: 'todo',
        executionStrategy: 'single',
        stageKey: null,
        memberIds: [],
        source: null
      })
      expect(created).toEqual({ ok: false, error: 'control_plane_unreachable' })
    })
  })
})
