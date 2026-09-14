/**
 * A chat session bound to a subject, started fresh each time it is opened.
 *
 * Two subjects use it. The org chat is one session for the whole library — the surface you talk to
 * about anything, so it has to be able to reach every project rather than sit inside one. A
 * project's Chat tab is one session per project, which is what lets someone begin a question in the
 * right context and create the ticket only when the work turns out to deserve one.
 *
 * They differ by subject id and by which repositories they prefer, and by nothing else, so they are
 * one hook — two would drift on the fence rules below, which are the expensive half.
 *
 * **Fresh, not resumed.** Reattaching to the last bound session looked like continuity and behaved
 * like a trap: the provider child can be gone while the transcript still reads back, and a send
 * against a session with no runtime fence is queued in the outbox and never dispatched — silently,
 * with the panel reading Idle. Starting one is a second of latency; the other way costs a message
 * you thought you sent. The binding is still written, so the orchestration DB names the session
 * that is current; nothing reads it back to decide whether to start.
 *
 * It still needs a workspace to run in, because an agent session runs somewhere. Any repository
 * will do, bound to a project or not — the MCP tools it works through are org-wide, and the working
 * directory only decides where a file it reads comes from. That is what lets it answer before the
 * first project exists, which is often when you most want to ask it something.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import { useAppStore } from '@/store'
import {
  ORG_CHAT_SUBJECT_ID,
  type TaskSessionBinding
} from '../../../../../shared/alicorn/task-session'
import type { Project } from '../../../../../shared/alicorn/projects'
import { launchAlicornSession } from './launch-alicorn-session'

export type AlicornChatState = {
  session: TaskSessionBinding | null
  loading: boolean
  starting: boolean
  error: string | null
  /** Null while no repository at all is resolved here — there is nowhere to run. */
  repoId: string | undefined
  restart: () => void
}

export function useAlicornChat(args: {
  /** What owns this conversation. A subject owns exactly one conversation, so this is its key. */
  subjectId: string
  /** Repositories to prefer, in store order. Falls back to any repository on the machine. */
  preferredRepoIds: readonly string[]
  /** The model the surface is set to. Applied at launch; changing it opens a new session. */
  model: string | null
}): AlicornChatState {
  const { subjectId, preferredRepoIds, model } = args
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const [session, setSession] = React.useState<TaskSessionBinding | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // A repository bound to a project first, then any repository at all. Deterministic in both
  // cases, so a restart lands in the same place rather than wherever the store ordered things.
  //
  // The fallback is what makes the assistant answerable before the first project exists. Asking it
  // something is often how you decide what the first project should be, and the working directory
  // only decides where a file it reads comes from — the alicorn_* tools it actually works through
  // are org-wide, so an unbound repository serves just as well as a bound one.
  const preferredKey = preferredRepoIds.join(',')
  const repoId = React.useMemo(() => {
    const preferred = new Set(preferredKey ? preferredKey.split(',') : [])
    return repos.find((repo) => preferred.has(repo.id))?.id ?? repos[0]?.id
  }, [preferredKey, repos])

  const start = React.useCallback(async (): Promise<void> => {
    const api = window.api?.alicorn
    if (!repoId || !api?.bindSubjectSession) {
      return
    }
    setStarting(true)
    setError(null)
    try {
      // Scanned on demand, for the same reason a task's session scans: a repository is recorded
      // without being scanned, so an empty list here means "not looked at yet", not "none".
      let workspace = (worktreesByRepo[repoId] ?? [])[0]
      if (!workspace) {
        await useAppStore.getState().fetchWorktrees(repoId)
        workspace = (useAppStore.getState().worktreesByRepo[repoId] ?? [])[0]
      }
      if (!workspace) {
        setError(
          translate(
            'auto.components.alicorn.assistant.noWorkspace',
            'The assistant could not open its workspace. Check that the repository folder still exists.'
          )
        )
        return
      }
      // No opening prompt. The MCP server's own `instructions` already tell the agent what the
      // alicorn_* tools do and that every change answers with a receipt, so a priming message would
      // only put the framing in the transcript as something the developer appears to have typed —
      // and then answer a question nobody asked. It waits.
      const binding = await launchAlicornSession({ worktreeId: workspace.id, model })
      await api.bindSubjectSession(subjectId, binding)
      setSession(binding)
    } catch (cause) {
      setError(describeFailure(cause))
    } finally {
      setStarting(false)
    }
  }, [model, repoId, subjectId, worktreesByRepo])

  // Once per mount and once per model, never after a failure: the ref survives StrictMode's
  // double-invoke, so a development mount does not open two sessions, and a refused start does not
  // retry every render. The model is the one thing that legitimately opens another, because it is
  // fixed at launch — holding a boolean here meant picking a model changed the header and left the
  // session running the old one.
  const autoStartedModel = React.useRef<string | null | undefined>(undefined)
  React.useEffect(() => {
    if (starting || !repoId || autoStartedModel.current === model) {
      return
    }
    autoStartedModel.current = model
    void start()
  }, [model, repoId, start, starting])

  return {
    session,
    loading: starting && session === null,
    starting,
    error,
    repoId,
    restart: () => void start()
  }
}

/**
 * The org chat. One session for the whole library, preferring a repository some project owns so the
 * working directory is a place the developer recognises.
 */
export function useOrgChat(
  projects: readonly Project[],
  model: string | null = null
): AlicornChatState {
  const preferredRepoIds = React.useMemo(
    () => projects.flatMap((project) => project.repoIds),
    [projects]
  )
  return useAlicornChat({ subjectId: ORG_CHAT_SUBJECT_ID, preferredRepoIds, model })
}
