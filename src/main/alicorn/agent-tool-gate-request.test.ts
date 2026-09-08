import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateAgentToolGateRequest } from './agent-tool-gate-request'
import { QA_SANDBOX_DENIAL_LOG_PREFIX } from './qa-sandbox/qa-sandbox-denial-log'

let workspace: string

beforeAll(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'alicorn-qa-gate-')))
  mkdirSync(join(workspace, 'src'), { recursive: true })
  mkdirSync(join(workspace, 'tests'), { recursive: true })
  writeFileSync(join(workspace, 'src', 'impl.ts'), '')
  writeFileSync(join(workspace, 'tests', 'impl.test.ts'), '')
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

function ask(toolName: string, input: Record<string, unknown>, role: string) {
  return evaluateAgentToolGateRequest(
    { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: input, cwd: workspace },
    { 'x-alicorn-role': role }
  )
}

describe('evaluateAgentToolGateRequest', () => {
  it('denies a QA pane the implementation, in both spellings Claude accepts', () => {
    const response = ask('Read', { file_path: 'src/impl.ts' }, 'qa')
    expect(response?.decision).toBe('block')
    expect(response?.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(response?.hookSpecificOutput.permissionDecisionReason).toBe(response?.reason)
  })

  it('lets a QA pane write its tests', () => {
    expect(ask('Write', { file_path: 'tests/new.test.ts' }, 'qa')).toBeNull()
  })

  // A QA pane must not be judged by the lead policy, which would block its writes outright.
  it('routes by role rather than applying one policy to both', () => {
    expect(ask('Write', { file_path: 'tests/new.test.ts' }, 'lead')?.decision).toBe('block')
  })

  // An unknown role keeps the behaviour this endpoint had before QA existed.
  it('falls back to the lead policy for an absent role', () => {
    expect(
      evaluateAgentToolGateRequest({
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: 'src/impl.ts' },
        cwd: workspace
      })?.decision
    ).toBe('block')
  })

  // Without a workspace there is nothing to measure a path against.
  it('denies a QA pane that reports no working directory', () => {
    const response = evaluateAgentToolGateRequest(
      { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'a.ts' } },
      { 'x-alicorn-role': 'qa' }
    )
    expect(response?.decision).toBe('block')
    expect(response?.reason).toContain('no working directory')
  })

  it('ignores an event that is not PreToolUse', () => {
    expect(
      evaluateAgentToolGateRequest(
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Read',
          tool_input: { file_path: 'src/impl.ts' },
          cwd: workspace
        },
        { 'x-alicorn-role': 'qa' }
      )
    ).toBeNull()
  })

  // The lead branch shrugs at a payload it cannot read; QA must not.
  it('denies a QA pane a payload it cannot read', () => {
    expect(evaluateAgentToolGateRequest('not-json', { 'x-alicorn-role': 'qa' })?.decision).toBe(
      'block'
    )
    expect(
      evaluateAgentToolGateRequest(
        {
          hook_event_name: 'PreToolUse',
          tool_input: { file_path: 'tests/a.test.ts' },
          cwd: workspace
        },
        { 'x-alicorn-role': 'qa' }
      )?.decision
    ).toBe('block')
  })

  it('records every QA denial where an operator can count them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      ask('Read', { file_path: 'src/impl.ts' }, 'qa')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(QA_SANDBOX_DENIAL_LOG_PREFIX))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(workspace))
    } finally {
      warn.mockRestore()
    }
  })
})
