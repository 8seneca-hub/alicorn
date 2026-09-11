/**
 * Starting a task: giving the ticket a workspace, and remembering which one.
 *
 * This is the join PRODUCT-ARCHITECTURE §2 asks for — "the task replaces the worktree as the thing
 * you open, name, assign and finish". Until it exists a task is a row nobody can work on, and the
 * board is a picture of work rather than the thing that moves it.
 *
 * The worktree itself is Orca's `createWorktree`, untouched: branch naming, setup scripts, SSH
 * hosts and lineage are all decisions it already makes correctly, and a second creator would be a
 * second place for them to be got wrong. What is added here is the binding — the tuple in
 * `alicorn_task_worktrees` that says this workspace belongs to this task.
 */
import React from 'react'
import { useAppStore } from '@/store'
import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import { appendSeatMcpConfigLaunchArgs } from '../../../../../shared/tui-agent-launch-defaults'
import { isMacUserAgent } from '@/components/terminal-pane/pane-helpers'
import type { TaskWorktreeTuple } from '../../../../../shared/alicorn/feature-workspace-tuples'
import type { Task } from '../../../../../shared/alicorn/tasks'
import type { WorktreeStartupLaunch } from '../../../../../shared/worktree/launch-types'

/**
 * The brief the session opens with: the title, and the context someone wrote for it.
 *
 * This is the whole point of capturing context on the task — an agent that has to rediscover the
 * constraint is the underinformed member the ledger cannot tell from a wrong one.
 */
export function taskOpeningPrompt(ref: string, task: Pick<Task, 'title' | 'context'>): string {
  const brief = task.context.trim()
  return brief ? `${ref} — ${task.title}\n\n${brief}` : `${ref} — ${task.title}`
}

/** `feat/pay-142-refund-api`. The task's own id is in the branch so a reviewer can place it. */
export function taskBranchName(projectKey: string, task: Pick<Task, 'number' | 'title'>): string {
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28)
    .replace(/-$/, '')
  const ref = `${projectKey.toLowerCase()}-${task.number}`
  return slug ? `feat/${ref}-${slug}` : `feat/${ref}`
}

export type TaskWorkspaceState = {
  tuples: TaskWorktreeTuple[]
  /** True while a workspace is being created and bound. */
  starting: boolean
  error: string | null
  start: (repoId: string) => Promise<void>
  reload: () => void
}

export function useTaskWorkspace(task: Task, projectKey: string): TaskWorkspaceState {
  const createWorktree = useAppStore((state) => state.createWorktree)
  const [tuples, setTuples] = React.useState<TaskWorktreeTuple[]>([])
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadCount, setReloadCount] = React.useState(0)
  const reload = React.useCallback(() => setReloadCount((count) => count + 1), [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = window.api?.alicorn?.listTaskWorktrees
      if (!list) {
        return
      }
      const result = await list(task.id)
      if (!cancelled && result.ok) {
        setTuples(result.tuples)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [task.id, reloadCount])

  const start = React.useCallback(
    async (repoId: string): Promise<void> => {
      const bind = window.api?.alicorn?.bindTaskWorktrees
      if (!bind) {
        setError('control_plane_unreachable')
        return
      }
      setStarting(true)
      setError(null)
      try {
        const name = taskBranchName(projectKey, task)
        const startup = await buildTaskStartup(task, projectKey)
        const created = await createWorktree(
          repoId,
          name,
          undefined,
          undefined,
          undefined,
          'sidebar',
          undefined,
          undefined,
          undefined,
          undefined,
          'claude',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          startup ?? undefined
        )
        // Bound before anything else runs in it: a workspace whose task is unknown is exactly the
        // orphan row this join exists to stop.
        const bound = await bind(task.id, [
          {
            repoId,
            worktreeId: created.worktree.id,
            branch: created.worktree.branch ?? name,
            primary: true
          }
        ])
        if (bound.ok) {
          setTuples(bound.tuples)
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setStarting(false)
      }
    },
    [createWorktree, projectKey, task]
  )

  return { tuples, starting, error, start, reload }
}

/**
 * How a task's session starts: Claude, holding Alicorn's MCP, opened on the task's brief.
 *
 * The MCP is attached here rather than written into the repository's `.mcp.json`, so a session
 * Alicorn starts can reach the control plane without a tracked file changing in someone's repo.
 * Null when anything is missing — a session that starts without the tools is far better than one
 * that does not start.
 */
async function buildTaskStartup(
  task: Task,
  projectKey: string
): Promise<WorktreeStartupLaunch | null> {
  const configPath = await window.api?.alicorn?.mcpConfigPath?.()
  const settings = useAppStore.getState().settings
  const plan = buildAgentStartupPlan({
    agent: 'claude',
    prompt: taskOpeningPrompt(`${projectKey}-${task.number}`, task),
    cmdOverrides: settings?.agentCmdOverrides ?? {},
    agentArgs: appendSeatMcpConfigLaunchArgs(null, configPath?.ok ? configPath.path : undefined),
    platform: isMacUserAgent() ? 'darwin' : 'linux',
    allowEmptyPromptLaunch: true
  })
  if (!plan) {
    return null
  }
  return {
    command: plan.launchCommand,
    launchAgent: plan.agent,
    launchConfig: plan.launchConfig,
    ...(plan.launchToken ? { launchToken: plan.launchToken } : {}),
    ...(plan.env ? { env: plan.env } : {}),
    ...(plan.startupCommandDelivery ? { startupCommandDelivery: plan.startupCommandDelivery } : {})
  }
}
