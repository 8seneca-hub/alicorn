/**
 * A project's tasks, read from the control plane.
 *
 * The board and the task list are two readings of these rows — not of Orca's worktrees. A worktree
 * is one thing a task might need (PRODUCT-ARCHITECTURE §2); binding the board to worktrees showed
 * a repository where a ticket belongs and could never show a task that had not been started.
 */
import React from 'react'
import type { Task, TaskInput, TaskPatch } from '../../../../../shared/alicorn/tasks'

export type TaskResult = { ok: true; task: Task } | { ok: false; error: string }

export type ProjectTasksState = {
  tasks: Task[]
  /** Null until the first read settles; a string when the control plane refused. */
  error: string | null
  loading: boolean
  reload: () => void
  create: (input: Omit<TaskInput, 'projectId'>) => Promise<TaskResult>
  /** Optimistic: the card moves now and rolls back if the write is refused. */
  update: (id: string, patch: TaskPatch) => Promise<TaskResult>
}

const UNREACHABLE = 'control_plane_unreachable'

export function useProjectTasks(projectId: string): ProjectTasksState {
  const [tasks, setTasks] = React.useState<Task[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [reloadCount, setReloadCount] = React.useState(0)
  const reload = React.useCallback(() => setReloadCount((count) => count + 1), [])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      // Why optional: a render surface under test may not install window.api, and an older host
      // has no alicorn bridge at all — both degrade to "unreachable" rather than throwing.
      const list = window.api?.alicorn?.listTasks
      if (!list) {
        if (!cancelled) {
          setError(UNREACHABLE)
          setLoading(false)
        }
        return
      }
      const result = await list(projectId)
      if (cancelled) {
        return
      }
      if (result.ok) {
        setTasks(result.tasks)
        setError(null)
      } else {
        setError(result.error)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, reloadCount])

  const create = React.useCallback(
    async (input: Omit<TaskInput, 'projectId'>): Promise<TaskResult> => {
      const post = window.api?.alicorn?.createTask
      if (!post) {
        return { ok: false, error: UNREACHABLE }
      }
      const result = await post({ ...input, projectId })
      if (!result.ok) {
        return result
      }
      // Newest first, matching the server's ordering rather than re-sorting by a second rule.
      setTasks((current) => [result.task, ...current])
      return result
    },
    [projectId]
  )

  const update = React.useCallback(async (id: string, patch: TaskPatch): Promise<TaskResult> => {
    const put = window.api?.alicorn?.updateTask
    if (!put) {
      return { ok: false, error: UNREACHABLE }
    }
    let rollback: Task | undefined
    setTasks((current) => {
      rollback = current.find((task) => task.id === id)
      return current.map((task) => (task.id === id ? { ...task, ...patch } : task))
    })
    const result = await put(id, patch)
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? (result.ok ? result.task : (rollback ?? task)) : task
      )
    )
    return result
  }, [])

  return { tasks, error, loading, reload, create, update }
}
