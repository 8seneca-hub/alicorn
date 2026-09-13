/**
 * What the workflow permits, read from the control plane.
 *
 * Split from the RPC methods because it is the half that *decides*: the methods marshal arguments,
 * these two read the stages and the policies and answer whether a move is allowed. Keeping them
 * apart means the rule can be read without the plumbing around it.
 *
 * `readJson` is passed in rather than imported, because importing it from the methods module would
 * make the two import each other.
 */
import { columnAdvanceIsLegal } from '../../../../shared/alicorn/workflow-gate'
import type { AutonomyPolicy } from '../../../../shared/alicorn/gate-policy'
import type { Task } from '../../../../shared/alicorn/tasks'
import type { WorkflowStage } from '../../../../shared/alicorn/workflows'

export type ReadJson = <T>(path: string, init?: RequestInit) => Promise<T>

export type StageRules = { stages: WorkflowStage[]; policies: AutonomyPolicy[] }

/**
 * The stages a task runs through and the policies that judge them.
 *
 * Read together because the gate rule needs both, and reading them in two places would let a
 * refusal and the reason for it come from different moments.
 */
export async function readStageRules(
  readJson: ReadJson,
  task: Pick<Task, 'workflowId' | 'projectId'>
): Promise<StageRules> {
  if (!task.workflowId) {
    return { stages: [], policies: [] }
  }
  const [workflow, autonomy] = await Promise.all([
    readJson<{ workflow: { stages: WorkflowStage[] } }>(
      `/v1/workflows/${encodeURIComponent(task.workflowId)}`
    ),
    // A project with no policies is the common case and not an error; the gate rule reads an empty
    // list as "nobody decided", which gates.
    readJson<{ policies: AutonomyPolicy[] }>(
      `/v1/projects/${encodeURIComponent(task.projectId)}/autonomy-policies`
    ).catch(() => ({ policies: [] as AutonomyPolicy[] }))
  ])
  return { stages: workflow.workflow.stages ?? [], policies: autonomy.policies ?? [] }
}

export type ColumnRefusal = { ok: false; reason: string; message: string }

/** Non-null when the move is a skip, in which case it is the answer the caller gets. */
export async function refuseIllegalColumnMove(
  readJson: ReadJson,
  taskId: string,
  column: string
): Promise<ColumnRefusal | null> {
  const { task } = await readJson<{ task: Task }>(`/v1/tasks/${encodeURIComponent(taskId)}`)
  if (!task.workflowId) {
    return null
  }
  const { stages } = await readStageRules(readJson, task)
  if (columnAdvanceIsLegal({ stages, from: task.stageKey, toColumn: column })) {
    return null
  }
  return {
    ok: false,
    reason: 'skips_a_stage',
    message: `Moving to "${column}" would skip a stage of this task's workflow. Advance one stage at a time with alicorn_advance_stage, which gates where it must.`
  }
}
