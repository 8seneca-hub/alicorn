// Hand-mirrored from cloud/packages/control-plane-contract/src/workflow.ts — the read side only.
// The desktop never authors a workflow; that is the Control API's job.

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

export type WorkflowTransition = {
  from: string
  to: string
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
