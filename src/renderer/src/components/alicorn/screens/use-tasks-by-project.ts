/**
 * Every project's tasks, read once, with the open count derived from the same rows.
 *
 * The sidebar badge, the project cards and the board have to agree, and the only way to guarantee
 * that is to count the same rows once. Counting worktrees here was the original defect: a project
 * with three tickets and no branches yet reported zero, and a repository showed up where a ticket
 * belonged.
 *
 * The rows are returned rather than only their count because the cross-project inbox has to look
 * inside each task's session for a question waiting on someone. A second hook fanning out over the
 * same boards would read every row twice to answer two questions about the same list.
 */
import React from 'react'
import type { Project } from '../../../../../shared/alicorn/projects'
import type { Task } from '../../../../../shared/alicorn/tasks'
import { TASK_DONE_COLUMN } from '../../../../../shared/alicorn/tasks'

export function useTasksByProject(projects: readonly Project[]): Record<string, Task[]> {
  const [tasksByProject, setTasksByProject] = React.useState<Record<string, Task[]>>({})
  // Why the ids and not the array: the projects array is rebuilt on every store write, and keying
  // the effect on it would refetch every board on an unrelated change.
  const projectIds = projects.map((project) => project.id).join(',')

  React.useEffect(() => {
    let cancelled = false
    const ids = projectIds ? projectIds.split(',') : []
    void (async () => {
      const list = window.api?.alicorn?.listTasks
      if (!list || ids.length === 0) {
        return
      }
      const results = await Promise.all(
        ids.map(async (id) => {
          const result = await list(id)
          // A project whose board could not be read contributes no entry rather than an empty one,
          // so an unreadable board reads as unknown instead of as a project with no work.
          return result.ok ? ([id, result.tasks] as const) : null
        })
      )
      if (!cancelled) {
        setTasksByProject(Object.fromEntries(results.filter((entry) => entry !== null)))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectIds])

  return tasksByProject
}

/** Open work is open *tasks* — a project with three tickets and no branch yet has three. */
export function openTaskCounts(tasksByProject: Record<string, Task[]>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [projectId, tasks] of Object.entries(tasksByProject)) {
    counts[projectId] = tasks.filter((task) => task.column !== TASK_DONE_COLUMN).length
  }
  return counts
}
