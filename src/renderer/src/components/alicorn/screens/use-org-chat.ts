/**
 * The org chat: one Claude session for the whole library.
 *
 * One session, not one per project — it is the surface you talk to about anything, so it has to be
 * able to reach every project rather than sit inside one. It opens when the screen does, for the
 * same reason a ticket's does: what you came here to do is talk.
 *
 * It still needs a workspace to run in, because an agent session runs somewhere. Any project's
 * repository will do — the MCP tools it works through are org-wide, and the working directory only
 * decides where a file it reads comes from.
 */
import React from 'react'
import { useAppStore } from '@/store'
import {
  ORG_CHAT_SUBJECT_ID,
  type TaskSessionBinding
} from '../../../../../shared/alicorn/task-session'
import type { Project } from '../../../../../shared/alicorn/projects'
import { launchAlicornSession } from './launch-alicorn-session'

/**
 * What the session is told about where it is standing.
 *
 * It names the reach and points at the tools rather than describing them: the MCP server's own
 * `instructions` already carry the rules, including that every change answers with a receipt.
 */
export function orgChatPrompt(): string {
  return [
    'You are the Alicorn org chat. You speak for the whole library, not for one project.',
    '',
    'Use the alicorn_* MCP tools to read and change anything across it — projects and their',
    'boards, tasks in any of them, and the members every project draws on. Quote each receipt',
    'back so the change is auditable.',
    '',
    'Start by telling me what is waiting on me across every project.'
  ].join('\n')
}

export type OrgChatState = {
  session: TaskSessionBinding | null
  loading: boolean
  starting: boolean
  error: string | null
  /** Null while no project has a repository resolved here — there is nowhere to run. */
  repoId: string | undefined
  restart: () => void
}

export function useOrgChat(projects: readonly Project[]): OrgChatState {
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const [session, setSession] = React.useState<TaskSessionBinding | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // The first repository any project has resolved on this machine. Deterministic so a restart
  // lands in the same place rather than wherever the store happened to order things today.
  const repoId = React.useMemo(() => {
    const bound = new Set(projects.flatMap((project) => project.repoIds))
    return repos.find((repo) => bound.has(repo.id))?.id
  }, [projects, repos])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const read = await window.api?.alicorn?.getSubjectSession?.(ORG_CHAT_SUBJECT_ID)
      if (!cancelled) {
        setSession(read?.ok ? read.session : null)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const start = React.useCallback(async (): Promise<void> => {
    const api = window.api?.alicorn
    if (!repoId || !api?.bindSubjectSession) {
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
      const binding = await launchAlicornSession({
        worktreeId: workspace.id,
        prompt: orgChatPrompt()
      })
      await api.bindSubjectSession(ORG_CHAT_SUBJECT_ID, binding)
      setSession(binding)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStarting(false)
    }
  }, [repoId, worktreesByRepo])

  // Once, and never after a failure: a refused start would otherwise retry on every render.
  const autoStarted = React.useRef(false)
  React.useEffect(() => {
    if (loading || starting || session || !repoId || autoStarted.current) {
      return
    }
    autoStarted.current = true
    void start()
  }, [loading, repoId, session, start, starting])

  return { session, loading, starting, error, repoId, restart: () => void start() }
}
