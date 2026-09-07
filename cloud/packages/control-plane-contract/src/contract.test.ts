import { describe, expect, it } from 'vitest'
import {
  FEATURE_DELIVERY_STAGE_KEYS,
  FEATURE_DELIVERY_TEMPLATE,
  findWorkflowTemplate,
  HumanVerdictPatchSchema,
  InterruptionInputSchema,
  InterruptionsReportSchema,
  MemberInputSchema,
  RuleProposalInputSchema,
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

  // A code stage runs a command instead of a model, so `code` is a legal outcome backend even
  // though no member can be configured with it.
  it('accepts the code backend on an outcome but not on a member', () => {
    const parsed = StepOutcomeInputSchema.parse({
      runId: 'run_1', taskId: 'task_1', dispatchId: 'code-task_1', outcome: 'succeeded', backend: 'code'
    })
    expect(parsed.backend).toBe('code')
    expect(() =>
      MemberInputSchema.parse({ name: 'x', role: 'developer', backend: 'code', workspaceKind: 'worktree', permissionMode: 'ask' })
    ).toThrow()
  })

  it('defaults usage to null for a spend patch with only spendCents', () => {
    const parsed = SpendPatchSchema.parse({ spendCents: 82 })
    expect(parsed.usage).toBeNull()
  })

  it('defaults amendedAfterMs to null and source to manual for a human-verdict patch', () => {
    const parsed = HumanVerdictPatchSchema.parse({ humanVerdict: 'accepted' })
    expect(parsed.amendedAfterMs).toBeNull()
    expect(parsed.source).toBe('manual')
  })

  it('defaults resolvedBy to null and accepts the three interruption kinds', () => {
    const parsed = InterruptionInputSchema.parse({
      runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1',
      kind: 'gate', sourceId: 'gate_1', occurredAt: '2026-09-06T00:00:00.000Z'
    })
    expect(parsed.resolvedBy).toBeNull()
  })

  it('rejects an interruption kind outside gate/ask/escalation', () => {
    expect(() => InterruptionInputSchema.parse({
      runId: 'run_1', taskId: 'task_1', dispatchId: 'ctx_1',
      kind: 'permission_prompt', sourceId: 'gate_1', occurredAt: '2026-09-06T00:00:00.000Z'
    })).toThrow()
  })

  it('parses an interruptions report with permission_prompt always excluded', () => {
    const parsed = InterruptionsReportSchema.parse({
      filters: { stageKey: 'build' },
      completedTasks: 2, interruptions: 3, perCompletedTask: 1.5,
      byKind: { gate: 1, ask: 1, escalation: 1 },
      byStage: [{ stageKey: 'build', completedTasks: 2, interruptions: 3, perCompletedTask: 1.5 }],
      excluded: ['permission_prompt']
    })
    expect(parsed.excluded).toEqual(['permission_prompt'])
  })

})

describe('rule proposal contract', () => {
  it('accepts a proposal input and keeps unknown context fields via passthrough', () => {
    const parsed = RuleProposalInputSchema.parse({
      memberId: 'member_1', outcomeId: 'outcome_1', verdict: 'amended',
      context: { sha: 'abc123', files: ['a.ts'], excerpt: 'diff', extra: 'kept' }
    })
    expect(parsed.context).toEqual({ sha: 'abc123', files: ['a.ts'], excerpt: 'diff', extra: 'kept' })
  })

  it('rejects a verdict outside amended/rejected', () => {
    expect(() => RuleProposalInputSchema.parse({
      memberId: 'member_1', outcomeId: 'outcome_1', verdict: 'accepted', context: {}
    })).toThrow()
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
      key: 'spec', name: '', ordinal: 0, memberId: null, columnId: null,
      kind: 'worker', codeCommand: null,
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

describe('code stages', () => {
  const codeGraph = (over: Record<string, unknown> = {}) => ({
    projectId: 'local',
    name: 'With a code stage',
    stages: [{ key: 'format', ordinal: 0, kind: 'code', codeCommand: 'pnpm format', ...over }],
    transitions: []
  })

  it('accepts a code stage carrying a command', () => {
    const parsed = WorkflowInputSchema.parse(codeGraph())
    expect(parsed.stages[0]).toMatchObject({ kind: 'code', codeCommand: 'pnpm format' })
  })

  // Why reject: a code stage with nothing to run is a stage that can never complete, and the
  // failure would only appear when a board move reached it.
  it('rejects a code stage with no command', () => {
    expect(() => WorkflowInputSchema.parse(codeGraph({ codeCommand: null }))).toThrow(
      /code_stage_requires_command/
    )
  })

  // Why reject rather than ignore: a member on a code stage reads as "this dispatches an agent",
  // and dropping it silently would make the canvas lie about what runs.
  it('rejects a member on a code stage', () => {
    expect(() => WorkflowInputSchema.parse(codeGraph({ memberId: 'member-1' }))).toThrow(
      /code_stage_takes_no_member/
    )
  })

  it('defaults a stage to worker so existing workflows are unchanged', () => {
    const parsed = WorkflowInputSchema.parse({
      projectId: 'local',
      name: 'Plain',
      stages: [{ key: 'build', ordinal: 0 }],
      transitions: []
    })
    expect(parsed.stages[0]).toMatchObject({ kind: 'worker', codeCommand: null })
  })
})
