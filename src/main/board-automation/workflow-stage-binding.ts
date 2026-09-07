import type { Workflow, WorkflowStage } from '../../shared/alicorn/workflows'

/**
 * What a board column resolves to for a project.
 *
 * `unavailable` is deliberately distinct from `none`. A project with no workflow is the ordinary
 * pre-v1.5 case and falls back to the ad-hoc rules; a project whose workflow could not be read is a
 * different thing entirely, and dispatching there would mean guessing at `reversibility` — which
 * ARCHITECTURE §7 says is authored on the stage and never inferred. Guessing wrong once is a
 * production deploy, so that case refuses.
 */
export type StageBinding =
  | { kind: 'stage'; stage: WorkflowStage; workflowId: string; workflowVersion: number }
  | { kind: 'no-stage'; workflowId: string; workflowVersion: number }
  | { kind: 'none' }
  | { kind: 'unavailable'; detail: string }

/**
 * The stage a board column binds to.
 *
 * The binding is by `key`: a stage keyed `in-review` *is* the In review column. That is the whole
 * "one model, two views" claim — the board and the canvas render one object rather than two that
 * happen to agree — and it is why WF1 made the wire address stages by key rather than by id.
 */
export function bindColumnToStage(workflow: Workflow, toStatusId: string): StageBinding {
  const stage = workflow.stages.find((candidate) => candidate.key === toStatusId)
  if (!stage) {
    return { kind: 'no-stage', workflowId: workflow.id, workflowVersion: workflow.version }
  }
  return { kind: 'stage', stage, workflowId: workflow.id, workflowVersion: workflow.version }
}

// Why the first workflow: a project has one board, so one workflow governs it. Until WF4's
// templates let a project hold several, taking the first is honest rather than arbitrary — and
// `workflows_tenant_project_name` means the list is stable.
export function selectProjectWorkflow<T extends { id: string }>(workflows: readonly T[]): T | null {
  return workflows[0] ?? null
}
