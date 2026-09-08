import { z } from 'zod'
import { RequiredChecksSchema } from './required-check.js'

export const STAGE_REVERSIBILITY = ['free', 'contained', 'irreversible'] as const
export const INHERITED_COSTS = ['low', 'high'] as const
export const TRIGGER_KINDS = ['on_success', 'on_failure', 'manual'] as const

/**
 * The two return paths GRAPH-ENGINEERING names. A **correction edge** sends a failed unit back to
 * the step that produced it; a forward edge carries work onward.
 *
 * Authored, not derived from the trigger — for the same reason `reversibility` is. An `on_failure`
 * edge can legitimately go forward to a triage stage, and a `manual` edge can be a correction.
 * Deriving the kind would make the canvas draw a graph nobody authored.
 */
export const TRANSITION_KINDS = ['forward', 'correction'] as const
export const TransitionKindSchema = z.enum(TRANSITION_KINDS)

export const STAGE_KINDS = ['worker', 'code'] as const
export const StageKindSchema = z.enum(STAGE_KINDS)

export const StageReversibilitySchema = z.enum(STAGE_REVERSIBILITY)
export const InheritedCostSchema = z.enum(INHERITED_COSTS)

// Why: same shape as step_outcomes.stage_key (64 chars) so a stage joins the ledger without translation.
export const StageKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, 'invalid_stage_key')

export const StageInputSchema = z.object({
  key: StageKeySchema,
  name: z.string().trim().max(120).default(''),
  ordinal: z.number().int().nonnegative(),
  memberId: z.string().min(1).nullable().default(null),
  /**
   * Board column this stage dispatches on (`WorkspaceStatus.id`), or null for a stage no column
   * triggers.
   *
   * Separate from `key` because the two vocabularies are different granularities: a pipeline has
   * eight stages where a board has four columns, so several stages can share one column. Binding on
   * `key` alone assumed they matched, and they do not — see plan decision 11.
   */
  columnId: z.string().trim().min(1).max(64).nullable().default(null),
  /**
   * `code` runs a deterministic command with no member and no model — merge, rank, dedupe, format.
   * Routing that work through a model is the most common waste the framework names
   * (GRAPH-ENGINEERING, WF5), so it is a first-class stage kind rather than a degenerate worker.
   */
  kind: StageKindSchema.default('worker'),
  /** Required for a `code` stage and meaningless on a `worker` one. */
  codeCommand: z.string().trim().min(1).max(2000).nullable().default(null),
  // Why: ARCHITECTURE §7 — authored, never inferred, and the default is the safe value.
  reversibility: StageReversibilitySchema.default('contained'),
  inheritedCost: InheritedCostSchema.default('low'),
  requiredChecks: RequiredChecksSchema.default([])
})

// Why: objects rather than bare literals so WF3's board-column trigger adds fields additively.
export const TriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('on_success') }),
  z.object({ kind: z.literal('on_failure') }),
  z.object({ kind: z.literal('manual') })
])

export const TransitionInputSchema = z.object({
  from: StageKeySchema,
  to: StageKeySchema,
  // Why a default: WF1 shipped without this field, so every stored and in-flight edge reads as
  // forward unless someone authored otherwise.
  kind: TransitionKindSchema.default('forward'),
  trigger: TriggerSchema
})

const WorkflowGraphShape = z.object({
  projectId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  stages: z.array(StageInputSchema).min(1).max(40),
  transitions: z.array(TransitionInputSchema).max(200).default([])
})

type WorkflowGraph = z.infer<typeof WorkflowGraphShape>

function checkGraph(graph: WorkflowGraph, ctx: z.RefinementCtx): void {
  graph.stages.forEach((stage, i) => {
    if (stage.kind === 'code' && !stage.codeCommand) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stages', i, 'codeCommand'],
        message: 'code_stage_requires_command'
      })
    }
    // Why reject rather than ignore: a member authored on a code stage reads as "this dispatches
    // an agent", and silently dropping it would make the canvas lie about what runs.
    if (stage.kind === 'code' && stage.memberId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stages', i, 'memberId'],
        message: 'code_stage_takes_no_member'
      })
    }
  })
  const keys = new Set<string>()
  graph.stages.forEach((stage, i) => {
    if (keys.has(stage.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stages', i, 'key'], message: 'duplicate_stage_key' })
    }
    keys.add(stage.key)
  })

  // Why: ordinals must be exactly 0..n-1 — the schema is the only place contiguity is enforced,
  // because a unique index on (workflow_id, ordinal) would break a reorder mid-statement.
  const ordinals = [...graph.stages].map((s) => s.ordinal).sort((a, b) => a - b)
  ordinals.forEach((ordinal, i) => {
    if (ordinal !== i) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stages'], message: 'ordinals_must_be_contiguous_from_zero' })
    }
  })

  const ordinalByKey = new Map(graph.stages.map((stage) => [stage.key, stage.ordinal]))
  const edges = new Set<string>()
  const triggered = new Set<string>()
  graph.transitions.forEach((transition, i) => {
    if (!keys.has(transition.from)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions', i, 'from'], message: 'unknown_stage_key' })
    }
    if (!keys.has(transition.to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions', i, 'to'], message: 'unknown_stage_key' })
    }
    if (transition.from === transition.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions', i], message: 'self_transition' })
    }
    const edge = `${transition.from}->${transition.to}`
    if (edges.has(edge)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions', i], message: 'duplicate_transition' })
    }
    edges.add(edge)
    // Why: one edge per (from, trigger) keeps dispatch deterministic. Cycles stay legal — WF2 makes
    // the return edge first-class.
    const fired = `${transition.from}:${transition.trigger.kind}`
    if (triggered.has(fired)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions', i, 'trigger'], message: 'ambiguous_trigger' })
    }
    triggered.add(fired)

    // Why enforce direction: the kind is what the canvas draws, so an edge labelled `correction`
    // that runs onward would draw a return arc for work that never returns. Skipped when either
    // endpoint is unknown — that issue is already reported above.
    const from = ordinalByKey.get(transition.from)
    const to = ordinalByKey.get(transition.to)
    if (from === undefined || to === undefined) return
    if (transition.kind === 'correction' && to >= from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions', i, 'kind'], message: 'correction_edge_must_return' })
    }
    if (transition.kind === 'forward' && to < from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions', i, 'kind'], message: 'forward_edge_must_not_return' })
    }
  })
}

export const WorkflowInputSchema = WorkflowGraphShape.superRefine(checkGraph)

export const WorkflowUpdateSchema = WorkflowGraphShape.extend({
  version: z.number().int().positive()
}).superRefine(checkGraph)

export const WorkflowSchema = WorkflowGraphShape.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  version: z.number().int().positive(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const WorkflowSummarySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  stageCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime()
})

export type StageReversibility = z.infer<typeof StageReversibilitySchema>
export type InheritedCost = z.infer<typeof InheritedCostSchema>
export type Trigger = z.infer<typeof TriggerSchema>
export type TransitionKind = z.infer<typeof TransitionKindSchema>
// Why: a stored stage and an authored one have the same shape — the defaults are already applied.
export type Stage = z.infer<typeof StageInputSchema>
export type StageInput = z.input<typeof StageInputSchema>
export type TransitionInput = z.infer<typeof TransitionInputSchema>
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>
export type WorkflowUpdate = z.infer<typeof WorkflowUpdateSchema>
export type Workflow = z.infer<typeof WorkflowSchema>
export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>
