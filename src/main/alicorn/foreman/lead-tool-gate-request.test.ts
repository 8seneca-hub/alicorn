import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { evaluateLeadToolGateRequest } from './lead-tool-gate-request'

const WT = join('/repo', 'wt')

function ask(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  return evaluateLeadToolGateRequest(
    { hook_event_name: 'PreToolUse', cwd: WT, ...payload },
    headers
  )
}

describe('evaluateLeadToolGateRequest', () => {
  it('denies a write in both spellings Claude accepts', () => {
    const denial = ask({ tool_name: 'Write', tool_input: { file_path: join(WT, 'src/a.ts') } })

    expect(denial).toMatchObject({
      decision: 'block',
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' }
    })
    expect(denial?.reason).toBe(denial?.hookSpecificOutput.permissionDecisionReason)
  })

  it('denies reading implementation', () => {
    expect(
      ask({ tool_name: 'Read', tool_input: { file_path: join(WT, 'src/a.ts') } })?.decision
    ).toBe('block')
  })

  it('allows the journal', () => {
    expect(
      ask({ tool_name: 'Read', tool_input: { file_path: join(WT, '.foreman/journal.md') } })
    ).toBeNull()
  })

  it('allows a tool it does not police', () => {
    expect(ask({ tool_name: 'Bash', tool_input: { command: 'pnpm test' } })).toBeNull()
  })

  // Why the header: the payload's cwd is the primary source, but a gate that cannot locate the
  // worktree has no decision to make, and that would leave the lead unrestricted.
  it('falls back to the cwd header when the payload carries none', () => {
    expect(
      evaluateLeadToolGateRequest(
        { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } },
        { 'x-alicorn-cwd': WT }
      )?.decision
    ).toBe('block')
  })

  it('makes no decision without a worktree', () => {
    expect(
      evaluateLeadToolGateRequest({
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/x/a.ts' }
      })
    ).toBeNull()
  })

  // Only this hook calls the endpoint, so an absent event name is its own; a different one is not.
  it('accepts an absent event name and refuses a different one', () => {
    expect(
      evaluateLeadToolGateRequest({ cwd: WT, tool_name: 'Write', tool_input: {} })?.decision
    ).toBe('block')
    expect(
      evaluateLeadToolGateRequest({
        hook_event_name: 'PostToolUse',
        cwd: WT,
        tool_name: 'Write',
        tool_input: {}
      })
    ).toBeNull()
  })

  it.each([null, 'text', 42, [], {}])('makes no decision on the malformed body %p', (body) => {
    expect(evaluateLeadToolGateRequest(body)).toBeNull()
  })
})
