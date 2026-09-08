// Hand-mirrored from cloud/packages/control-plane-contract/src/workflow.ts. WF1 mirrored the read
// side only; WF2's canvas authors a graph too, so the write shapes are here as well. The Control
// API still owns validation — these types are what the canvas sends, not a second rulebook.

import type { RequiredCheck } from './members'

export const STAGE_REVERSIBILITY = ['free', 'contained', 'irreversible'] as const
export type StageReversibility = (typeof STAGE_REVERSIBILITY)[number]

export const INHERITED_COSTS = ['low', 'high'] as const
export type InheritedCost = (typeof INHERITED_COSTS)[number]

export type TriggerKind = 'on_success' | 'on_failure' | 'manual'

export const STAGE_KINDS = ['worker', 'code'] as const
export type StageKind = (typeof STAGE_KINDS)[number]

export type WorkflowStage = {
  /** Matches a board column id (`WorkspaceStatus.id`) and `step_outcomes.stage_key`. */
  key: string
  name: string
  ordinal: number
  memberId: string | null
  /** Board column that dispatches this stage (`WorkspaceStatus.id`), or null when none does. */
  columnId: string | null
  /** `code` runs a deterministic command with no member and no model. */
  kind: StageKind
  /** Set for a `code` stage, null on a `worker` one. */
  codeCommand: string | null
  reversibility: StageReversibility
  inheritedCost: InheritedCost
  requiredChecks: RequiredCheck[]
}

/**
 * The two return paths GRAPH-ENGINEERING names. `correction` is the return edge — findings going
 * back to the author. Authored on the transition, never derived from the trigger.
 */
export const TRANSITION_KINDS = ['forward', 'correction'] as const
export type TransitionKind = (typeof TRANSITION_KINDS)[number]

export type WorkflowTransition = {
  from: string
  to: string
  kind: TransitionKind
  trigger: { kind: TriggerKind }
}

export type Workflow = {
  id: string
  tenantId: string
  projectId: string
  name: string
  version: number
  stages: WorkflowStage[]
  transitions: WorkflowTransition[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type WorkflowSummary = {
  id: string
  projectId: string
  name: string
  version: number
  stageCount: number
  updatedAt: string
}

/** What the canvas sends. Identity and version live on the request, not in the graph. */
export type WorkflowGraphInput = {
  projectId: string
  name: string
  stages: WorkflowStage[]
  transitions: WorkflowTransition[]
}

/** A stage of a shipped template: names a *role*, which instantiation binds to a member. */
export type WorkflowTemplateStage = {
  key: string
  name: string
  ordinal: number
  memberRole: string | null
  columnId: string | null
  reversibility: StageReversibility
  inheritedCost: InheritedCost
}

export type WorkflowTemplate = {
  key: string
  name: string
  description: string
  stages: WorkflowTemplateStage[]
  transitions: WorkflowTransition[]
}
