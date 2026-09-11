/**
 * The project chat: one Claude session that can see and change the project in words.
 *
 * It is an ordinary Orca workspace, not an embedded pane. Mounting a terminal inside the Alicorn
 * shell would need a tab that belongs to no worktree — exactly the tab-model problem UI5 exists to
 * solve — while a workspace gets session resume, split panes, the right-sidebar panels and the
 * status dot for free. Alicorn's contribution is the brief and the tools.
 *
 * One per project, found by its branch rather than remembered in a table: a chat that has been
 * deleted should be re-creatable, and a row claiming a workspace that no longer exists is worse
 * than looking.
 */
import React from 'react'
import { useAppStore } from '@/store'
import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import { appendSeatMcpConfigLaunchArgs } from '../../../../../shared/tui-agent-launch-defaults'
import { isMacUserAgent } from '@/components/terminal-pane/pane-helpers'
import type { Project } from '../../../../../shared/alicorn/projects'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { WorktreeStartupLaunch } from '../../../../../shared/worktree/launch-types'

/** `alicorn/pay-chat`. Namespaced so it never collides with a branch someone means to ship. */
export function projectChatBranch(projectKey: string): string {
  return `alicorn/${projectKey.toLowerCase()}-chat`
}

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
  /** The chat workspace, when one already exists. */
  worktree: Worktree | null
  starting: boolean
  error: string | null
  open: () => void
  start: (repoId: string) => Promise<void>
}

export function useProjectChat(project: Project | undefined): ProjectChatState {
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const createWorktree = useAppStore((state) => state.createWorktree)
  const setActiveWorktree = useAppStore((state) => state.setActiveWorktree)
  const setActiveView = useAppStore((state) => state.setActiveView)
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const worktree = React.useMemo(() => {
    if (!project) {
      return null
    }
    const branch = projectChatBranch(project.key)
    for (const repoId of project.repoIds) {
      const found = (worktreesByRepo[repoId] ?? []).find((candidate) => candidate.branch === branch)
      if (found) {
        return found
      }
    }
    return null
  }, [project, worktreesByRepo])

  const open = React.useCallback(() => {
    if (worktree) {
      setActiveWorktree(worktree.id)
      setActiveView('terminal')
    }
  }, [setActiveView, setActiveWorktree, worktree])

  const start = React.useCallback(
    async (repoId: string): Promise<void> => {
      if (!project) {
        return
      }
      setStarting(true)
      setError(null)
      try {
        const configPath = await window.api?.alicorn?.mcpConfigPath?.()
        const settings = useAppStore.getState().settings
        const plan = buildAgentStartupPlan({
          agent: 'claude',
          prompt: projectChatPrompt(project),
          cmdOverrides: settings?.agentCmdOverrides ?? {},
          agentArgs: appendSeatMcpConfigLaunchArgs(
            null,
            configPath?.ok ? configPath.path : undefined
          ),
          platform: isMacUserAgent() ? 'darwin' : 'linux',
          allowEmptyPromptLaunch: true
        })
        const startup: WorktreeStartupLaunch | undefined = plan
          ? {
              command: plan.launchCommand,
              launchAgent: plan.agent,
              launchConfig: plan.launchConfig,
              ...(plan.launchToken ? { launchToken: plan.launchToken } : {}),
              ...(plan.env ? { env: plan.env } : {}),
              ...(plan.startupCommandDelivery
                ? { startupCommandDelivery: plan.startupCommandDelivery }
                : {})
            }
          : undefined
        const created = await createWorktree(
          repoId,
          `${project.key.toLowerCase()}-chat`,
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
          projectChatBranch(project.key),
          undefined,
          undefined,
          undefined,
          startup
        )
        setActiveWorktree(created.worktree.id)
        setActiveView('terminal')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setStarting(false)
      }
    },
    [createWorktree, project, setActiveView, setActiveWorktree]
  )

  return { worktree, starting, error, open, start }
}
