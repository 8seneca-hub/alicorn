/**
 * A project's tasks, read from the control plane.
 *
 * The board and the task list are two readings of these rows — not of Alicorn's worktrees. A worktree
 * is one thing a task might need (PRODUCT-ARCHITECTURE §2); binding the board to worktrees showed
 * a repository where a ticket belongs and could never show a task that had not been started.
 */
import React from 'react'
import { useAppStore } from '@/store'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { Task, TaskInput, TaskPatch } from '../../../../../shared/alicorn/tasks'
import { planTaskMoveAutomation } from './task-board-automation'

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
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const [tasks, setTasks] = React.useState<Task[]>([])
  // Mirrors `tasks` so a write can read what a row looked like before it changed it.
  const tasksRef = React.useRef<Task[]>(tasks)
  tasksRef.current = tasks
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

  const update = React.useCallback(
    async (id: string, patch: TaskPatch): Promise<TaskResult> => {
      const put = window.api?.alicorn?.updateTask
      if (!put) {
        return { ok: false, error: UNREACHABLE }
      }
      // Read before the optimistic write, not inside its updater: React runs the updater on the
      // next render, which is after the await below — so a value captured there is undefined
      // exactly when it is needed, and a refused move would never roll back.
      const rollback = tasksRef.current.find((task) => task.id === id)
      setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)))
      const result = await put(id, patch)
      setTasks((current) =>
        current.map((task) =>
          task.id === id ? (result.ok ? result.task : (rollback ?? task)) : task
        )
      )
      // The move is what dispatches. Every surface that moves a task comes through here, so the
      // board, the list and the task screen cannot disagree about whether work starts.
      if (result.ok && patch.column && rollback?.column !== patch.column) {
        void announceTaskMove(id, rollback?.column ?? null, patch.column, worktreesByRepo)
      }
      return result
    },
    [worktreesByRepo]
  )

  return { tasks, error, loading, reload, create, update }
}

/**
 * Tells board automation a task moved, if it has anywhere to run.
 *
 * Swallowed on purpose, exactly as the board's own move does: a rule that cannot dispatch must
 * never make the card fail to move, and the refusal is already recorded where the kill switch can
 * show it.
 */
async function announceTaskMove(
  taskId: string,
  fromColumn: string | null,
  toColumn: string,
  worktreesByRepo: Record<string, Worktree[]>
): Promise<void> {
  try {
    const listTuples = window.api?.alicorn?.listTaskWorktrees
    const statusChanged = window.api?.boardAutomation?.statusChanged
    if (!listTuples || !statusChanged) {
      return
    }
    const bound = await listTuples(taskId)
    if (!bound.ok) {
      return
    }
    const plan = planTaskMoveAutomation({
      tuples: bound.tuples,
      worktreesByRepo,
      fromColumn,
      toColumn
    })
    if (plan) {
      await statusChanged(plan)
    }
  } catch {
    // See above: a dispatch failure is not a reason for the card not to have moved.
  }
}
