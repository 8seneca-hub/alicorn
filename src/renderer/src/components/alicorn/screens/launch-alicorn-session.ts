/**
 * Opening a session for one Alicorn subject — a task, or a project's chat.
 *
 * Why this exists rather than calling `startStructuredAgentLaunch` directly: Alicorn dedupes pending
 * launches by `(worktree, agent)`, which is right for its own callers — two places asking for "a
 * Claude chat on this worktree" should get one. Alicorn's subjects want the opposite. Every
 * subject is its own conversation, and they nearly always share a worktree (a project usually has
 * one repository), so two subjects opening at once would otherwise join the same session and
 * appear to be synced.
 *
 * Serialising is the whole fix: a launch is removed from Alicorn's pending map once it settles, so
 * waiting for the previous one guarantees the next gets its own session.
 */
import type { TaskSessionBinding } from '../../../../../shared/alicorn/task-session'
import type { AgentSessionHandleProvider } from '../../../../../shared/agent-session-provider-handle'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { createStructuredAgentSessionOperationId } from '../../../../../shared/structured-agent-session-mutation'
import { structuredAgentSessionPayloadFingerprint } from '../../../../../shared/structured-agent-session-mutation'

/**
 * The model is chosen *after* the session exists, because `agentSession.create` takes a worktree
 * and an agent and nothing else. The launch receipt carries the fence the option write needs, so
 * this is one extra call rather than a wire change — and a failure here costs the session its
 * model, never its start.
 */
async function applyModel(sessionId: string, fence: number, model: string): Promise<void> {
  try {
    await callStructuredAgentSession({ kind: 'local' }, 'agentSession.setOption', {
      envelope: {
        sessionId,
        clientOperationId: createStructuredAgentSessionOperationId(() => crypto.randomUUID()),
        expectedRuntimeFence: fence,
        payloadFingerprint: structuredAgentSessionPayloadFingerprint({
          method: 'agentSession.setOption',
          sessionId,
          fields: { key: 'model', value: model }
        })
      },
      key: 'model',
      value: model
    })
  } catch {
    // Deliberately swallowed: see above.
  }
}

/** One chain per worktree; two different worktrees have no reason to wait on each other. */
const launchChainByWorktree = new Map<string, Promise<unknown>>()

export async function launchAlicornSession(args: {
  worktreeId: string
  /** Omit to open a session that waits. A ticket has a brief to deliver; the assistant does not. */
  prompt?: string
  /** The member's backend. Defaults to Claude, which is what an unassigned ticket gets. */
  agent?: AgentSessionHandleProvider
  /** A catalog model id. Omit to take the backend's own default. */
  model?: string | null
}): Promise<TaskSessionBinding> {
  const previous = launchChainByWorktree.get(args.worktreeId) ?? Promise.resolve()
  const run = previous
    // A previous subject's failure is not this one's problem, but its *completion* is what this
    // one waits for, so the rejection is swallowed rather than propagated.
    .catch(() => undefined)
    .then(async () => {
      const { startStructuredAgentLaunch } = await import('@/lib/structured-agent-session-launch')
      const agent = args.agent ?? 'claude'
      const launch = startStructuredAgentLaunch(
        args.worktreeId,
        agent,
        args.prompt ? { prompt: args.prompt } : {}
      )
      // Awaited before the caller may bind it: a session id that never became a session would
      // leave the subject pointing at a conversation nobody can open.
      const receipt = await launch.launchResult
      if (args.model) {
        await applyModel(launch.sessionId, receipt.fence, args.model)
      }
      return {
        sessionId: launch.sessionId,
        agent,
        worktreeId: args.worktreeId
      } satisfies TaskSessionBinding
    })

  launchChainByWorktree.set(args.worktreeId, run)
  try {
    return await run
  } finally {
    if (launchChainByWorktree.get(args.worktreeId) === run) {
      launchChainByWorktree.delete(args.worktreeId)
    }
  }
}
