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
 * Binds on `columnId`, not on `key`. The two vocabularies are different granularities — WF4's
 * template has eight pipeline stages against the board's four columns, and verifying WF3 against
 * the seeded stack showed the key sets share nothing (plan decision 11). A stage therefore names
 * the column that dispatches it, and several stages may sit behind one column.
 */
export function bindColumnToStage(workflow: Workflow, toStatusId: string): StageBinding {
  const stage = workflow.stages.find((candidate) => candidate.columnId === toStatusId)
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
