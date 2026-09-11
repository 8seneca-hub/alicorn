/**
 * How many tasks each project still has open.
 *
 * The sidebar badge, the project cards and the board have to agree, and the only way to guarantee
 * that is to count the same rows once. Counting worktrees here was the original defect: a project
 * with three tickets and no branches yet reported zero, and a repository showed up where a ticket
 * belonged.
 */
import React from 'react'
import type { Project } from '../../../../../shared/alicorn/projects'
import { TASK_DONE_COLUMN } from '../../../../../shared/alicorn/tasks'

export function useOpenTaskCounts(projects: readonly Project[]): Record<string, number> {
  const [counts, setCounts] = React.useState<Record<string, number>>({})
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
          // A project whose board could not be read contributes no number rather than a zero.
          return result.ok
            ? ([
                id,
                result.tasks.filter((task) => task.column !== TASK_DONE_COLUMN).length
              ] as const)
            : null
        })
      )
      if (!cancelled) {
        setCounts(Object.fromEntries(results.filter((entry) => entry !== null)))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectIds])

  return counts
}
