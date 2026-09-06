import { describe, expect, it } from 'vitest'
import { MemberInputSchema, StepOutcomeInputSchema } from './index.js'

describe('control-plane contract', () => {
  it('accepts a minimal member input and applies defaults', () => {
    const parsed = MemberInputSchema.parse({
      name: 'Reviewer',
      role: 'reviewer',
      backend: 'codex',
      workspaceKind: 'worktree',
      permissionMode: 'accept_edits'
    })
    expect(parsed.systemRules).toBe('')
    expect(parsed.skills).toEqual([])
  })

  it('rejects an unknown backend', () => {
    expect(() =>
      MemberInputSchema.parse({ name: 'x', role: 'developer', backend: 'gemini', workspaceKind: 'worktree', permissionMode: 'ask' })
    ).toThrow()
  })

  it('defaults execution strategy to single and stage key to build', () => {
    const parsed = StepOutcomeInputSchema.parse({
      runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1', outcome: 'succeeded'
    })
    expect(parsed.executionStrategy).toBe('single')
    expect(parsed.stageKey).toBe('build')
    expect(parsed.filesModified).toEqual([])
  })

})
