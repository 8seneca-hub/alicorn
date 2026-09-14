import { useEffect, useMemo, useState } from 'react'
import { buildSearchableAlicornTasks, searchAlicornTasks } from '@/lib/alicorn-task-palette-search'
import { useAlicornProjects } from '@/components/alicorn/shell/use-alicorn-projects'
import type { Task } from '../../../shared/alicorn/tasks'
import type { TaskPaletteItem } from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'

type WorktreeJumpPaletteTasksInput = Pick<WorktreeJumpPaletteLocalState, 'paletteSearchQuery'>

/**
 * The board, from Cmd+J.
 *
 * Read per palette open rather than held in the app store: the palette only mounts while it is
 * showing, so one read per opening is the cheapest thing that cannot serve a stale board.
 */
export function useWorktreeJumpPaletteTasks({ paletteSearchQuery }: WorktreeJumpPaletteTasksInput) {
  const { projects } = useAlicornProjects()
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>({})
  // Why the ids and not the array: it is rebuilt on every read, and keying the effect on it would
  // refetch every board on an unrelated render.
  const projectIds = projects.map((project) => project.id).join(',')

  useEffect(() => {
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
          // A project whose board could not be read contributes nothing, never an empty board.
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

  const searchableTasks = useMemo(
    () => buildSearchableAlicornTasks(projects, tasksByProject),
    [projects, tasksByProject]
  )
  const taskMatches = useMemo(
    () => searchAlicornTasks(searchableTasks, paletteSearchQuery),
    [searchableTasks, paletteSearchQuery]
  )
  const taskItems = useMemo<TaskPaletteItem[]>(
    () =>
      taskMatches.map((result) => ({
        id: `task:${result.taskId}`,
        type: 'task' as const,
        result
      })),
    [taskMatches]
  )

  return { taskItems, hasAnyTasks: searchableTasks.length > 0 }
}

export type WorktreeJumpPaletteTasks = ReturnType<typeof useWorktreeJumpPaletteTasks>
