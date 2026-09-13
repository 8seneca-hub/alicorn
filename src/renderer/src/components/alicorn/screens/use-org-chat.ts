/**
 * The org chat: one Claude session for the whole library, started fresh each time it is opened.
 *
 * One session, not one per project — it is the surface you talk to about anything, so it has to be
 * able to reach every project rather than sit inside one.
 *
 * **Fresh, not resumed.** Reattaching to the last bound session looked like continuity and behaved
 * like a trap: the provider child can be gone while the transcript still reads back, and a send
 * against a session with no runtime fence is queued in the outbox and never dispatched — silently,
 * with the panel reading Idle. Starting one is a second of latency; the other way costs a message
 * you thought you sent. The binding is still written, so the orchestration DB names the session
 * that is current; nothing reads it back to decide whether to start.
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

export type OrgChatState = {
  session: TaskSessionBinding | null
  loading: boolean
  starting: boolean
  error: string | null
  /** Null while no project has a repository resolved here — there is nowhere to run. */
  repoId: string | undefined
  restart: () => void
}

export function useOrgChat(
  projects: readonly Project[],
  /** The model the panel is set to. Applied at launch; changing it opens a new session. */
  model: string | null = null
): OrgChatState {
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const [session, setSession] = React.useState<TaskSessionBinding | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // The first repository any project has resolved on this machine. Deterministic so a restart
  // lands in the same place rather than wherever the store happened to order things today.
  const repoId = React.useMemo(() => {
    const bound = new Set(projects.flatMap((project) => project.repoIds))
    return repos.find((repo) => bound.has(repo.id))?.id
  }, [projects, repos])

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
      // No opening prompt. The MCP server's own `instructions` already tell the agent what the
      // alicorn_* tools do and that every change answers with a receipt, so a priming message would
      // only put the framing in the transcript as something the developer appears to have typed —
      // and then answer a question nobody asked. It waits.
      const binding = await launchAlicornSession({ worktreeId: workspace.id, model })
      await api.bindSubjectSession(ORG_CHAT_SUBJECT_ID, binding)
      setSession(binding)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStarting(false)
    }
  }, [model, repoId, worktreesByRepo])

  // Once per mount, and never after a failure: the ref survives StrictMode's double-invoke, so a
  // development mount does not open two sessions, and a refused start does not retry every render.
  const autoStarted = React.useRef(false)
  React.useEffect(() => {
    if (starting || session || !repoId || autoStarted.current) {
      return
    }
    autoStarted.current = true
    void start()
  }, [repoId, session, start, starting])

  return {
    session,
    loading: starting && session === null,
    starting,
    error,
    repoId,
    restart: () => void start()
  }
}
