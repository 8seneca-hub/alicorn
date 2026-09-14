/**
 * The two methods that move a task through its workflow, and the only two that can refuse to.
 *
 * Apart from the rest because they are the enforcement: everything else here marshals a read or a
 * write, and these decide whether one is allowed at all. A reader looking for "what stops an agent"
 * should find one file.
 */
import { z } from 'zod'
import {
  agentMaySkip,
  describeGateReason,
  gateReasonFor,
  nextStageAfter
} from '../../../../shared/alicorn/workflow-gate'
import type { Task } from '../../../../shared/alicorn/tasks'
import { defineMethod, type RpcMethod } from '../core'
import { readStageRules, readStageTrackRecord, type ReadJson } from './alicorn-stage-rules'

/** Mirrors the actor seam in alicorn-control: only the MCP server ever sets `agent`. */
const ActorParam = z.enum(['human', 'agent']).default('human')

export function alicornStageMethods(readJson: ReadJson): RpcMethod[] {
  return [
    defineMethod({
      name: 'alicorn.taskAdvanceStage',
      params: z.object({ taskId: z.string().min(1), actor: ActorParam }),
      handler: async (params) => {
        const { task } = await readJson<{ task: Task }>(
          `/v1/tasks/${encodeURIComponent(params.taskId)}`
        )
        if (!task.workflowId) {
          return {
            ok: false as const,
            reason: 'no_workflow',
            message:
              'This task runs with no workflow, so it has no stages to advance through. Finish it and move the board.'
          }
        }
        const { stages, policies } = await readStageRules(readJson, task)
        const next = nextStageAfter({
          stages,
          from: task.stageKey,
          skipped: task.skippedStageKeys
        })
        if (next.kind === 'finished') {
          return { ok: false as const, reason: 'finished', message: 'This is the last stage.' }
        }
        if (next.kind === 'unknown-stage') {
          return {
            ok: false as const,
            reason: 'unknown_stage',
            message: `This task sits at "${task.stageKey}", which its workflow does not have.`
          }
        }
        // Read after the target is known, because the record is keyed by the stage being entered.
        const stats = await readStageTrackRecord(task.projectId, next.stage)
        const reason = gateReasonFor(next.stage, policies, stats)
        if (reason) {
          // The refusal is the feature. A human decides, and the agent is told which stage and why,
          // so it can ask for the right thing rather than retrying.
          return {
            ok: false as const,
            reason: 'gated',
            stageKey: next.stage.key,
            stageName: next.stage.name,
            message: `${describeGateReason(reason, next.stage.name)} Ask the developer to move it; do not move it yourself.`
          }
        }
        const body = await readJson<{ task: Task }>(
          `/v1/tasks/${encodeURIComponent(params.taskId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              stageKey: next.stage.key,
              ...(next.stage.columnId ? { column: next.stage.columnId } : {})
            })
          }
        )
        return {
          ok: true as const,
          task: body.task,
          stageKey: next.stage.key,
          stageName: next.stage.name
        }
      }
    }),
    defineMethod({
      name: 'alicorn.taskSkipStage',
      params: z.object({
        taskId: z.string().min(1),
        stageKey: z.string().min(1),
        actor: ActorParam
      }),
      handler: async (params) => {
        const { task } = await readJson<{ task: Task }>(
          `/v1/tasks/${encodeURIComponent(params.taskId)}`
        )
        const { stages, policies } = await readStageRules(readJson, task)
        const stage = stages.find((candidate) => candidate.key === params.stageKey)
        if (!stage) {
          return {
            ok: false as const,
            reason: 'unknown_stage',
            message: `This task's workflow has no stage "${params.stageKey}".`
          }
        }
        // "Not needed" is a scope judgement. An agent that could make it about a merge would have
        // walked around the gate by relabelling it, so the same rule answers here.
        const stats =
          params.actor === 'agent' ? await readStageTrackRecord(task.projectId, stage) : null
        if (params.actor === 'agent' && !agentMaySkip(stage, policies, stats)) {
          return {
            ok: false as const,
            reason: 'gated',
            stageKey: stage.key,
            message: `${describeGateReason(gateReasonFor(stage, policies, stats) ?? 'policy', stage.name)} You may not mark it unnecessary either — ask the developer.`
          }
        }
        const next = [...new Set([...task.skippedStageKeys, stage.key])]
        const body = await readJson<{ task: Task }>(
          `/v1/tasks/${encodeURIComponent(params.taskId)}`,
          { method: 'PATCH', body: JSON.stringify({ skippedStageKeys: next }) }
        )
        return { ok: true as const, task: body.task, stageKey: stage.key, stageName: stage.name }
      }
    })
  ]
}
