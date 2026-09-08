import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { resolveRunScope } from './orchestration-run-scope'

/**
 * MR1's wire surface. Both methods are new, so this is an additive wire change and needs no
 * capability negotiation: an older host simply does not offer them
 * (`docs/reference/remote-wire-compatibility.md`).
 */
const TupleParam = z.object({
  repoId: z.string().min(1),
  worktreeId: z.string().min(1),
  branch: z.string().nullish(),
  primary: z.boolean().optional()
})

// The CLI can only hand over a flag string, while the renderer sends real JSON. Accept both rather
// than making the caller care, mirroring how `--deps` is parsed for `orchestration.taskCreate`.
const TupleListParam = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}, z.array(TupleParam).max(50))

export const TaskWorktreesSetParams = z.object({
  id: z.string().min(1, 'Missing --id'),
  tuples: TupleListParam,
  callerTerminalHandle: z.string().optional(),
  run: z.string().optional()
})

export const TaskWorktreesListParams = z.object({
  id: z.string().min(1, 'Missing --id'),
  callerTerminalHandle: z.string().optional(),
  run: z.string().optional()
})

export const ORCHESTRATION_TASK_WORKTREE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.taskWorktreesSet',
    params: TaskWorktreesSetParams,
    handler: (params, { orchestrationCompatibilityEvidence, runtime, legacyCoordinatorRunId }) => {
      const db = runtime.getOrchestrationDb()
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.callerTerminalHandle,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence
      })
      const existing = db.getTask(params.id)
      if (!existing || existing.run_id !== run.id) {
        throw new OrchestrationError(
          'task_not_found',
          `Task ${params.id} was not found in Run ${run.id}.`
        )
      }
      // Normalization happens in the store, so the answer is the set that was actually written —
      // the caller learns which tuple became primary without a second round trip.
      const tuples = db.setTaskWorktrees(params.id, params.tuples)
      return { taskId: params.id, tuples, repoCount: db.countTaskRepos(params.id) }
    }
  }),

  defineMethod({
    name: 'orchestration.taskWorktreesList',
    params: TaskWorktreesListParams,
    handler: (params, { orchestrationCompatibilityEvidence, runtime, legacyCoordinatorRunId }) => {
      const db = runtime.getOrchestrationDb()
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.callerTerminalHandle,
        requireCurrentConsumer: false,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence
      })
      const existing = db.getTask(params.id)
      if (!existing || existing.run_id !== run.id) {
        throw new OrchestrationError(
          'task_not_found',
          `Task ${params.id} was not found in Run ${run.id}.`
        )
      }
      const tuples = db.listTaskWorktrees(params.id)
      return { taskId: params.id, tuples, repoCount: db.countTaskRepos(params.id) }
    }
  })
]
