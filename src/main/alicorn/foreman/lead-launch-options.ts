import { ALICORN_ROLE_ENV } from '../agent-pane-role'
import type { MemberBackend } from '../../../shared/alicorn/members'

/**
 * The lead plans, dispatches and re-plans. It writes no code and reads no implementation, because
 * the whole point of the layer is that implementation detail never enters its context
 * (CLAUDE.md, *Foreman is an add-on*). Enforced at launch, not asked for in a prompt.
 *
 * `--disallowedTools` alone is not the enforcement: Alicorn launches Claude with
 * `--dangerously-skip-permissions`, which skips the permission checks that flag is one of. The
 * `PreToolUse` deny hook in `lead-tool-policy.ts` runs whatever the permission mode, and is what
 * actually holds — see that file for the read half, which no launch flag can express.
 */
export const LEAD_DISALLOWED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const

/** Read by the PreToolUse hook to tell a restricted pane from an ordinary one. */
export { ALICORN_ROLE_ENV }

export type LeadLaunchOptions = { disallowedTools: string[]; env: Record<string, string> }
export type LeadLaunchUnsupported = { unsupported: true; reason: string }

/**
 * A backend that cannot restrict its own tools cannot host a lead. Refusing is the point: launching
 * one anyway would give a lead that quietly writes code, and the run would look orchestrated while
 * being nothing of the sort.
 */
export function leadLaunchOptions(
  backend: MemberBackend
): LeadLaunchOptions | LeadLaunchUnsupported {
  switch (backend) {
    case 'claude':
    case 'openclaude':
      return {
        disallowedTools: [...LEAD_DISALLOWED_TOOLS],
        env: { [ALICORN_ROLE_ENV]: 'lead' }
      }
    case 'codex':
    case 'grok':
      return {
        unsupported: true,
        reason: `${backend} cannot restrict tools at launch, so it cannot host a Foreman lead. Use a Claude-backed member for the lead, or run the task with execution_strategy single.`
      }
  }
}

export function isLeadLaunchUnsupported(
  options: LeadLaunchOptions | LeadLaunchUnsupported
): options is LeadLaunchUnsupported {
  return 'unsupported' in options
}
