/**
 * The project chat: one Claude session that can see and change the project in words.
 *
 * The same machinery a task's session uses, on a different subject. It opens when the screen does,
 * for the same reason a ticket's does — what you came to the chat to do is talk, and a button in
 * front of that is a step that answers nothing.
 *
 * One per project, keyed `project:<id>`, so reopening the screen returns to the conversation rather
 * than starting a second one beside it.
 */
import React from 'react'
import { useAppStore } from '@/store'
import {
  projectChatSubjectId,
  type TaskSessionBinding
} from '../../../../../shared/alicorn/task-session'
import type { Project } from '../../../../../shared/alicorn/projects'

/**
 * What the session is told about where it is standing.
 *
 * It names the project and points at the tools rather than describing them: the MCP server's own
 * `instructions` already carry the rules, including that every change answers with a receipt, and
 * repeating them here is a second copy to drift.
 */
export function projectChatPrompt(project: Pick<Project, 'name' | 'key'>): string {
  return [
    `You are the project chat for ${project.name} (${project.key}).`,
    '',
    'Use the alicorn_* MCP tools to read and change this project — its board, its tasks and the',
    'org library it draws members from. Quote each receipt back so the change is auditable.',
    '',
    'Start by telling me what is on the board and what is waiting on me.'
  ].join('\n')
}

export type ProjectChatState = {
  session: TaskSessionBinding | null
  loading: boolean
  starting: boolean
  error: string | null
  /** Opens a fresh session on the same brief. */
  restart: () => void
}

export function useProjectChat(project: Project | undefined): ProjectChatState {
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const [session, setSession] = React.useState<TaskSessionBinding | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const projectId = project?.id
  const repoId = project?.repoIds[0]

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSession(null)
    void (async () => {
      const read = projectId
        ? await window.api?.alicorn?.getSubjectSession?.(projectChatSubjectId(projectId))
        : null
      if (!cancelled) {
        setSession(read?.ok ? read.session : null)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const start = React.useCallback(async (): Promise<void> => {
    const api = window.api?.alicorn
    if (!project || !repoId || !api?.bindSubjectSession) {
      return
    }
    setStarting(true)
    setError(null)
    try {
      const workspace = (worktreesByRepo[repoId] ?? [])[0]
      if (!workspace) {
        setError('no_workspace')
        return
      }
      const { startStructuredAgentLaunch } = await import('@/lib/structured-agent-session-launch')
      const launch = startStructuredAgentLaunch(workspace.id, 'claude', {
        prompt: projectChatPrompt(project)
      })
      // Awaited before the binding is written: a session id that never became a session would
      // leave the project pointing at a conversation nobody can open.
      await launch.launchResult
      const binding: TaskSessionBinding = {
        sessionId: launch.sessionId,
        agent: 'claude',
        worktreeId: workspace.id
      }
      await api.bindSubjectSession(projectChatSubjectId(project.id), binding)
      setSession(binding)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStarting(false)
    }
  }, [project, repoId, worktreesByRepo])

  // Opening the screen opens the chat. Once per project and never after a failure, so a refused
  // start is not retried on every render of the screen it just failed on.
  const autoStartedProjectId = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (loading || starting || session || !projectId || !repoId) {
      return
    }
    if (autoStartedProjectId.current === projectId) {
      return
    }
    autoStartedProjectId.current = projectId
    void start()
  }, [loading, projectId, repoId, session, start, starting])

  return {
    session,
    loading,
    starting,
    error,
    restart: () => void start()
  }
}
