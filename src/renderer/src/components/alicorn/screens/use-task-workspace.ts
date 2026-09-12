/**
 * Starting a task: opening its session, and remembering which one it is.
 *
 * This is the join PRODUCT-ARCHITECTURE §2 asks for — "the task replaces the worktree as the thing
 * you open, name, assign and finish". Until it exists a task is a row nobody can work on, and the
 * board is a picture of work rather than the thing that moves it.
 *
 * Starting does **not** create a worktree. A branch is one way to do a task, not the definition of
 * one — a question, a review, a spike or a one-file change all want a session and no branch, and
 * the agent is better placed to decide than a button pressed before anyone has read the ticket.
 * So this opens a Claude session in the project's existing workspace and binds the task to it; if
 * the work turns out to need its own branch, the agent makes one.
 *
 * Two bindings are written, and they answer different questions. The tuple in
 * `alicorn_task_worktrees` says which workspace the task is being done in, which is what makes a
 * board move dispatch into it. The row in `alicorn_task_sessions` says which conversation is the
 * task's, which is what makes reopening the ticket return to it instead of starting a second one.
 */
import React from 'react'
import { useAppStore } from '@/store'
import type { TaskWorktreeTuple } from '../../../../../shared/alicorn/feature-workspace-tuples'
import type { TaskSessionBinding } from '../../../../../shared/alicorn/task-session'
import type { Task } from '../../../../../shared/alicorn/tasks'

/**
 * The brief the session opens with: the title, and the context someone wrote for it.
 *
 * This is the whole point of capturing context on the task — an agent that has to rediscover the
 * constraint is the underinformed member the ledger cannot tell from a wrong one.
 */
export function taskOpeningPrompt(ref: string, task: Pick<Task, 'title' | 'context'>): string {
  const brief = task.context.trim()
  const head = brief ? `${ref} — ${task.title}\n\n${brief}` : `${ref} — ${task.title}`
  return [
    head,
    '',
    'You are working this task inside Alicorn. Use the alicorn_* MCP tools to move it on the board,',
    'record what you did and pull in whoever else it needs. Decide for yourself whether this needs',
    'its own branch or worktree — nothing has been created for you.'
  ].join('\n')
}

export type TaskWorkspaceState = {
  tuples: TaskWorktreeTuple[]
  /** The conversation this task is being worked in; null until someone starts it. */
  session: TaskSessionBinding | null
  /** Which repository a session for this task goes in; undefined while that is still a choice. */
  repoId: string | undefined
  loading: boolean
  starting: boolean
  error: string | null
  start: (repoId: string) => Promise<void>
  reload: () => void
}

export function useTaskWorkspace(
  task: Task,
  projectKey: string,
  /** The repositories this project resolved on this machine; one of them will host the session. */
  projectRepoIds: readonly string[]
): TaskWorkspaceState {
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const [tuples, setTuples] = React.useState<TaskWorktreeTuple[]>([])
  const [session, setSession] = React.useState<TaskSessionBinding | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadCount, setReloadCount] = React.useState(0)
  const reload = React.useCallback(() => setReloadCount((count) => count + 1), [])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const api = window.api?.alicorn
      const [worktrees, bound] = await Promise.all([
        api?.listTaskWorktrees?.(task.id),
        api?.getTaskSession?.(task.id)
      ])
      if (cancelled) {
        return
      }
      if (worktrees?.ok) {
        setTuples(worktrees.tuples)
      }
      setSession(bound?.ok ? bound.session : null)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [task.id, reloadCount])

  const start = React.useCallback(
    async (repoId: string): Promise<void> => {
      const api = window.api?.alicorn
      if (!api?.bindTaskWorktrees || !api.bindTaskSession) {
        setError('control_plane_unreachable')
        return
      }
      setStarting(true)
      setError(null)
      try {
        // The repository's existing workspace. A task that needs its own branch gets one from the
        // agent working it, not from this button.
        const workspace = (worktreesByRepo[repoId] ?? [])[0]
        if (!workspace) {
          setError('no_workspace')
          return
        }
        const bound = await api.bindTaskWorktrees(task.id, [
          { repoId, worktreeId: workspace.id, branch: workspace.branch, primary: true }
        ])
        if (bound.ok) {
          setTuples(bound.tuples)
        }
        const { startStructuredAgentLaunch } = await import('@/lib/structured-agent-session-launch')
        const launch = startStructuredAgentLaunch(workspace.id, 'claude', {
          prompt: taskOpeningPrompt(`${projectKey}-${task.number}`, task)
        })
        // Awaited before the binding is written: a session id that never became a session would
        // leave the ticket pointing at a conversation nobody can open.
        await launch.launchResult
        const binding: TaskSessionBinding = {
          sessionId: launch.sessionId,
          agent: 'claude',
          worktreeId: workspace.id
        }
        await api.bindTaskSession(task.id, binding)
        setSession(binding)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setStarting(false)
      }
    },
    [projectKey, task, worktreesByRepo]
  )

  // Where the session goes: the repository this task is already bound to, else the project's only
  // one. Several repositories and nothing bound is a genuine choice, and picking for someone is
  // worse than asking — so it stays undefined and the workspace section asks.
  const repoId =
    tuples.find((tuple) => tuple.primary)?.repoId ??
    (projectRepoIds.length === 1 ? projectRepoIds[0] : undefined)

  // Opening the ticket opens the session. Once per task and never after a failure: a refused start
  // would otherwise be retried on every render of the screen it just failed on.
  const autoStartedTaskId = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (loading || starting || session || !repoId || autoStartedTaskId.current === task.id) {
      return
    }
    autoStartedTaskId.current = task.id
    void start(repoId)
  }, [loading, repoId, session, start, starting, task.id])

  return { tuples, session, repoId, loading, starting, error, start, reload }
}
