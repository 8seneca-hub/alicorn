import { describe, expect, it } from 'vitest'
import {
  FEATURE_DELIVERY_STAGE_KEYS,
  FEATURE_DELIVERY_TEMPLATE,
  findWorkflowTemplate,
  MemberInputSchema,
  SpendPatchSchema,
  StepOutcomeInputSchema,
  WorkflowInputSchema,
  WorkflowTemplateSchema
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

describe('workflow templates', () => {
  it('describes a valid template', () => {
    expect(() => WorkflowTemplateSchema.parse(FEATURE_DELIVERY_TEMPLATE)).not.toThrow()
    expect(FEATURE_DELIVERY_STAGE_KEYS).toEqual([
      'spec', 'architecture', 'design', 'build', 'review', 'verify', 'merge', 'deploy'
    ])
  })

  // Why: a template nobody can instantiate is worse than no template — this runs the graph through
  // the same validation the create route applies.
  it('instantiates through the workflow schema unchanged', () => {
    const parsed = WorkflowInputSchema.parse({
      projectId: 'local',
      name: FEATURE_DELIVERY_TEMPLATE.name,
      stages: FEATURE_DELIVERY_TEMPLATE.stages.map((s) => ({
        key: s.key, name: s.name, ordinal: s.ordinal, reversibility: s.reversibility, inheritedCost: s.inheritedCost
      })),
      transitions: FEATURE_DELIVERY_TEMPLATE.transitions.map((t) => ({ ...t }))
    })
    expect(parsed.stages).toHaveLength(8)
    expect(parsed.transitions).toHaveLength(9)
  })

  it('gates exactly where reversal is expensive', () => {
    const byKey = new Map(FEATURE_DELIVERY_TEMPLATE.stages.map((s) => [s.key, s]))
    expect(byKey.get('merge')!.reversibility).toBe('irreversible')
    expect(byKey.get('deploy')!.reversibility).toBe('irreversible')
    // Architecture is the one stage carrying inherited cost — the prototype's "inherited hard stop".
    expect(FEATURE_DELIVERY_TEMPLATE.stages.filter((s) => s.inheritedCost === 'high').map((s) => s.key)).toEqual([
      'architecture'
    ])
    // Merge and Deploy have no owner: a human resolves those gates.
    expect(byKey.get('merge')!.memberRole).toBeNull()
    expect(byKey.get('deploy')!.memberRole).toBeNull()
  })

  it('sends findings back to the author rather than forward', () => {
    const returns = FEATURE_DELIVERY_TEMPLATE.transitions.filter((t) => t.trigger.kind === 'on_failure')
    expect(returns.map((t) => [t.from, t.to])).toEqual([
      ['review', 'build'],
      ['verify', 'build']
    ])
  })

  it('resolves a template by key and reports an unknown one', () => {
    expect(findWorkflowTemplate('feature-delivery')?.name).toBe('Feature delivery')
    expect(findWorkflowTemplate('nope')).toBeUndefined()
  })

  it('authors no required checks — only diff_coverage is expressible today', () => {
    expect(WorkflowTemplateSchema.parse(FEATURE_DELIVERY_TEMPLATE).stages.every((s) => !('requiredChecks' in s))).toBe(true)
  })
})
