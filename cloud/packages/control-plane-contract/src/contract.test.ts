import { describe, expect, it } from 'vitest'
import {
  MemberInputSchema,
  SpendPatchSchema,
  StepOutcomeInputSchema,
  WorkflowInputSchema
} from './index.js'

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

  it('rejects duplicate skills', () => {
    expect(() =>
      MemberInputSchema.parse({
        name: 'x', role: 'developer', backend: 'codex', workspaceKind: 'worktree', permissionMode: 'ask',
        skills: ['a', 'a']
      })
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

  it('defaults usage to null for a spend patch with only spendCents', () => {
    const parsed = SpendPatchSchema.parse({ spendCents: 82 })
    expect(parsed.usage).toBeNull()
  })

})

describe('workflow contract', () => {
  const stage = (key: string, ordinal: number) => ({ key, ordinal })
  const graph = (over: Record<string, unknown> = {}) => ({
    projectId: 'local',
    name: 'Feature delivery',
    stages: [stage('spec', 0), stage('build', 1), stage('review', 2)],
    transitions: [
      { from: 'spec', to: 'build', trigger: { kind: 'on_success' } },
      { from: 'build', to: 'review', trigger: { kind: 'on_success' } }
    ],
    ...over
  })

  it('applies the safe stage defaults', () => {
    const parsed = WorkflowInputSchema.parse(graph())
    expect(parsed.stages[0]).toEqual({
      key: 'spec', name: '', ordinal: 0, memberId: null,
      reversibility: 'contained', inheritedCost: 'low', requiredChecks: []
    })
  })

  it('accepts a return edge — a cycle is legal', () => {
    const parsed = WorkflowInputSchema.parse(
      graph({ transitions: [
        { from: 'build', to: 'review', trigger: { kind: 'on_success' } },
        { from: 'review', to: 'build', trigger: { kind: 'on_failure' } }
      ] })
    )
    expect(parsed.transitions).toHaveLength(2)
  })

  it('rejects a duplicate stage key', () => {
    expect(() => WorkflowInputSchema.parse(graph({
      stages: [stage('build', 0), stage('build', 1)], transitions: []
    }))).toThrow(/duplicate_stage_key/)
  })

  it('rejects a gap in the ordinals', () => {
    expect(() => WorkflowInputSchema.parse(graph({
      stages: [stage('spec', 0), stage('build', 2)], transitions: []
    }))).toThrow(/ordinals_must_be_contiguous_from_zero/)
  })

  it('rejects a transition to an unknown stage', () => {
    expect(() => WorkflowInputSchema.parse(graph({
      transitions: [{ from: 'spec', to: 'qa', trigger: { kind: 'on_success' } }]
    }))).toThrow(/unknown_stage_key/)
  })

  it('rejects two on_success edges out of one stage', () => {
    expect(() => WorkflowInputSchema.parse(graph({
      transitions: [
        { from: 'spec', to: 'build', trigger: { kind: 'on_success' } },
        { from: 'spec', to: 'review', trigger: { kind: 'on_success' } }
      ]
    }))).toThrow(/ambiguous_trigger/)
  })

  it('rejects a stage key that would not fit stage_key', () => {
    expect(() => WorkflowInputSchema.parse(graph({
      stages: [{ key: 'Build Stage', ordinal: 0 }], transitions: []
    }))).toThrow(/invalid_stage_key/)
  })
})
