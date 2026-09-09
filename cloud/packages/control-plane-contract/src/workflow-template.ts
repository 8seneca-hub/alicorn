import { z } from 'zod'
import { MemberRoleSchema } from './member.js'
import {
  InheritedCostSchema,
  StageKeySchema,
  StageReversibilitySchema,
  TransitionInputSchema
} from './workflow.js'

// Why: a template is project-independent, so it names a *role* and instantiation binds the tenant's
// member holding it. A template can therefore ship in code, versioned with the release.
export const WorkflowTemplateStageSchema = z.object({
  key: StageKeySchema,
  name: z.string().min(1).max(120),
  ordinal: z.number().int().nonnegative(),
  memberRole: MemberRoleSchema.nullable(),
  /** Board column that dispatches this stage, or null when no column does. */
  columnId: z.string().min(1).max(64).nullable(),
  reversibility: StageReversibilitySchema,
  inheritedCost: InheritedCostSchema
})

export const WorkflowTemplateSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  stages: z.array(WorkflowTemplateStageSchema).min(1).max(40),
  transitions: z.array(TransitionInputSchema).max(200)
})

/**
 * The prototype's pipeline, authored exactly as its stage table has it
 * (`docs/alicorn/prototype/html/app-alicorn.html`). Attributes are transcribed, not invented:
 * Architecture is the one stage carrying inherited cost, Merge and Deploy are the two irreversible
 * ones, and everything else is `free` or worktree-`contained`. ARCHITECTURE §7 gates on each of those
 * before any track record is consulted, so a new project is gated where it should be on run one.
 *
 * No required checks are authored here. The prototype verifies these stages with test/types/lint,
 * security, e2e and smoke, and no `RequiredCheckSchema` variant carries a project's own thresholds or
 * commands — so authoring one on Build would be inventing a policy nobody asked for. Checks stay the
 * operator's call.
 */
export const FEATURE_DELIVERY_TEMPLATE = {
  key: 'feature-delivery',
  name: 'Feature delivery',
  description: 'Spec through Deploy, gated where reversal is expensive: Architecture inherits cost, Merge and Deploy are irreversible.',
  stages: [
    { key: 'spec', name: 'Spec', ordinal: 0, memberRole: 'analyst', columnId: 'todo', reversibility: 'free', inheritedCost: 'low' },
    // Why: "inherited hard stop" in the prototype — a wrong interface is inherited by everything after it.
    { key: 'architecture', name: 'Architecture', ordinal: 1, memberRole: 'analyst', columnId: null, reversibility: 'free', inheritedCost: 'high' },
    // Why: MEMBER_ROLES has no `designer`; the prototype's Designer maps to `other` until it does.
    { key: 'design', name: 'Design', ordinal: 2, memberRole: 'other', columnId: null, reversibility: 'free', inheritedCost: 'low' },
    { key: 'build', name: 'Build', ordinal: 3, memberRole: 'developer', columnId: 'in-progress', reversibility: 'contained', inheritedCost: 'low' },
    { key: 'review', name: 'Review', ordinal: 4, memberRole: 'reviewer', columnId: 'in-review', reversibility: 'contained', inheritedCost: 'low' },
    { key: 'verify', name: 'Verify', ordinal: 5, memberRole: 'qa', columnId: null, reversibility: 'contained', inheritedCost: 'low' },
    { key: 'merge', name: 'Merge', ordinal: 6, memberRole: null, columnId: 'completed', reversibility: 'irreversible', inheritedCost: 'low' },
    { key: 'deploy', name: 'Deploy', ordinal: 7, memberRole: null, columnId: null, reversibility: 'irreversible', inheritedCost: 'low' }
  ],
  transitions: [
    { from: 'spec', to: 'architecture', kind: 'forward', trigger: { kind: 'on_success' } },
    { from: 'architecture', to: 'design', kind: 'forward', trigger: { kind: 'on_success' } },
    { from: 'design', to: 'build', kind: 'forward', trigger: { kind: 'on_success' } },
    { from: 'build', to: 'review', kind: 'forward', trigger: { kind: 'on_success' } },
    { from: 'review', to: 'verify', kind: 'forward', trigger: { kind: 'on_success' } },
    { from: 'verify', to: 'merge', kind: 'forward', trigger: { kind: 'on_success' } },
    { from: 'merge', to: 'deploy', kind: 'forward', trigger: { kind: 'on_success' } },
    // Why: the correction edge carries the point of the diagram — findings go back to the author,
    // they do not become a new ticket.
    { from: 'review', to: 'build', kind: 'correction', trigger: { kind: 'on_failure' } },
    { from: 'verify', to: 'build', kind: 'correction', trigger: { kind: 'on_failure' } }
  ]
} as const satisfies z.infer<typeof WorkflowTemplateSchema>

export const WORKFLOW_TEMPLATES = [FEATURE_DELIVERY_TEMPLATE] as const

// Why: SK1 takes stage keys from templates rather than from free-text `phase`; this is the set.
export const FEATURE_DELIVERY_STAGE_KEYS = FEATURE_DELIVERY_TEMPLATE.stages.map((s) => s.key)

export function findWorkflowTemplate(key: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.key === key)
}

export const WorkflowFromTemplateSchema = z.object({
  templateKey: z.string().min(1).max(63),
  projectId: z.string().trim().min(1).max(200),
  // Why: optional — a project taking the template as-is should not have to name it.
  name: z.string().trim().min(1).max(120).optional()
})

export type WorkflowTemplateStage = z.infer<typeof WorkflowTemplateStageSchema>
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>
export type WorkflowFromTemplate = z.infer<typeof WorkflowFromTemplateSchema>
