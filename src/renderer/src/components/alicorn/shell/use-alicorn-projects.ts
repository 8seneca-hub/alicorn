/**
 * The org's projects, read once per mount from the control plane.
 *
 * A control plane that is not configured is not an error to show: it is the pre-Alicorn shape of
 * this app, and the shell has to say so plainly rather than render an empty list that looks like
 * "you have no projects".
 */
import { useCallback, useEffect, useState } from 'react'
import type { Project, ProjectInput } from '../../../../../shared/alicorn/projects'
import { translate } from '@/i18n/i18n'

export type AlicornProjectsState = {
  projects: Project[]
  /** Null while the first read is in flight; a string when the control plane refused. */
  error: string | null
  loading: boolean
  reload: () => void
  create: (
    input: ProjectInput
  ) => Promise<{ ok: true; project: Project } | { ok: false; error: string }>
  /** Unbinds the project's repositories and takes its board with it; the repositories stay. */
  remove: (projectId: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function useAlicornProjects(): AlicornProjectsState {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadCount, setReloadCount] = useState(0)
  const reload = useCallback(() => setReloadCount((count) => count + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Why optional: a render surface under test may not install window.api, and an older host
      // has no alicorn bridge at all — both degrade to "unreachable" rather than throwing.
      const list = window.api?.alicorn?.listProjects
      if (!list) {
        if (!cancelled) {
          setError('control_plane_unreachable')
          setLoading(false)
        }
        return
      }
      const result = await list()
      if (cancelled) {
        return
      }
      if (result.ok) {
        setProjects(result.projects)
        setError(null)
      } else {
        setError(result.error)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [reloadCount])

  const create = useCallback(
    async (
      input: ProjectInput
    ): Promise<{ ok: true; project: Project } | { ok: false; error: string }> => {
      const post = window.api?.alicorn?.createProject
      if (!post) {
        return {
          ok: false,
          error: translate(
            'auto.components.alicorn.shell.use.alicorn.projects.203752d3d3',
            'control_plane_unreachable'
          )
        }
      }
      const result = await post(input)
      if (result.ok) {
        setProjects((current) =>
          [...current, result.project].sort((a, b) => a.name.localeCompare(b.name))
        )
        return { ok: true, project: result.project }
      }
      return { ok: false, error: result.error }
    },
    []
  )

  const remove = useCallback(
    async (projectId: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const del = window.api?.alicorn?.deleteProject
      if (!del) {
        return {
          ok: false,
          error: translate(
            'auto.components.alicorn.shell.use.alicorn.projects.203752d3d3',
            'control_plane_unreachable'
          )
        }
      }
      const result = await del(projectId)
      if (result.ok) {
        setProjects((current) => current.filter((project) => project.id !== projectId))
      }
      return result
    },
    []
  )

  return { projects, error, loading, reload, create, remove }
}
