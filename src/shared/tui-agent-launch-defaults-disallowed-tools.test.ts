import { describe, expect, it } from 'vitest'
import {
  appendDisallowedToolsLaunchArgs,
  resolveTuiAgentLaunchArgs
} from './tui-agent-launch-defaults'
import { buildAgentStartupPlan } from './tui-agent-startup'

describe('appendDisallowedToolsLaunchArgs', () => {
  it('leaves the args untouched with nothing to disallow', () => {
    expect(appendDisallowedToolsLaunchArgs('--flag', undefined)).toBe('--flag')
    expect(appendDisallowedToolsLaunchArgs('--flag', [])).toBe('--flag')
    expect(appendDisallowedToolsLaunchArgs(null, undefined)).toBeNull()
  })

  it('is the only args when there were none', () => {
    expect(appendDisallowedToolsLaunchArgs('', ['Edit', 'Write'])).toBe(
      '--disallowedTools Edit Write'
    )
  })

  // Why: the defaults are Orca's own launch flags, and dropping them would change how the agent runs.
  it('keeps the existing args ahead of the flag', () => {
    expect(
      appendDisallowedToolsLaunchArgs(resolveTuiAgentLaunchArgs('claude', null), [
        'Edit',
        'NotebookEdit'
      ])
    ).toBe('--dangerously-skip-permissions --disallowedTools Edit NotebookEdit')
  })

  it('reaches the launch command as separate argv tokens', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: '',
      allowEmptyPromptLaunch: true,
      cmdOverrides: {},
      platform: 'linux',
      agentArgs: appendDisallowedToolsLaunchArgs(resolveTuiAgentLaunchArgs('claude', null), [
        'Edit',
        'Write'
      ])
    })

    expect(plan?.launchCommand).toBe(
      "claude '--dangerously-skip-permissions' '--disallowedTools' 'Edit' 'Write'"
    )
  })
})
