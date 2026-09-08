import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalBoolean, OptionalFiniteNumber, OptionalString, requiredString } from '../schemas'
import type { GateStatus } from '../../orchestration/db'
import { Coordinator } from '../../orchestration/coordinator'
import { resolveRunScope } from './orchestration-run-scope'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { DEFAULT_GATE_STAGE_KEY, evaluateGateForTask } from '../../../alicorn/gates/gate-evaluation'
import { resolveGateEvaluationInput } from '../../../alicorn/gates/gate-evaluation-context'
import { getLatestDispatchForTask } from '../../orchestration/db/dispatch-context/task-dispatch-reconciliation'
import type { GateDecision } from '../../../../shared/alicorn/gate-policy'

// Why: the coordinator instance is stored at module scope so orchestration.runStop
// can signal it to halt. Only one coordinator can run at a time (enforced by
// the DB's active-run check), so a single reference suffices.
let activeCoordinator: Coordinator | null = null

const RunParams = z.object({
  spec: requiredString('Missing --spec'),
  from: OptionalString,
  pollIntervalMs: OptionalFiniteNumber,
  maxConcurrent: OptionalFiniteNumber,
  worktree: OptionalString
})

const RunStopParams = z.object({})

const GateCreateParams = z.object({
  task: requiredString('Missing --task'),
  question: requiredString('Missing --question'),
  options: OptionalString,
  // ARCHITECTURE §8: the policy is evaluated here and nowhere else, so a caller cannot ask it and
  // then ignore the answer. There is deliberately no "should I gate?" RPC.
  evaluate: OptionalBoolean,
  stageKey: OptionalString,
  from: OptionalString,
  run: OptionalString
})

const VerifyRecordParams = z.object({
  task: requiredString('Missing --task'),
  name: requiredString('Missing --name'),
  status: z.enum(['passed', 'failed', 'skipped', 'error']),
  kind: OptionalString,
  dispatch: OptionalString,
  required: OptionalBoolean,
  detail: OptionalString,
  from: OptionalString,
  run: OptionalString
})

const GateResolveParams = z.object({
  id: requiredString('Missing --id'),
  resolution: requiredString('Missing --resolution'),
  from: OptionalString,
  run: OptionalString
})

const GateListParams = z.object({
  task: OptionalString,
  status: z.enum(['pending', 'resolved', 'timeout']).optional(),
  from: OptionalString,
  run: OptionalString
})

export const ORCHESTRATION_GATE_METHODS: RpcMethod[] = [
  // Why: Section 4.12 — orchestration.run returns immediately with a run ID.
  // The coordinator loop runs in the background; progress is queried via
  // orchestration.taskList. This prevents the RPC call from blocking the
  // CLI (or any caller) for the entire duration of the pipeline.
  defineMethod({
    name: 'orchestration.run',
    params: RunParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()

      const existing = db.getActiveCoordinatorRun()
      if (existing) {
        throw new Error(`Coordinator already running: ${existing.id}`)
      }

      const coordinatorHandle = params.from ?? 'coordinator'
      const coordinator = new Coordinator(db, runtime, {
        spec: params.spec,
        coordinatorHandle,
        pollIntervalMs: params.pollIntervalMs,
        maxConcurrent: params.maxConcurrent,
        worktree: params.worktree
      })

      activeCoordinator = coordinator

      const run = db.createCoordinatorRun({
        spec: params.spec,
        coordinatorHandle,
        pollIntervalMs: params.pollIntervalMs
      })

      // Why: fire-and-forget — the coordinator loop runs in the event loop
      // background. Results are persisted to the DB; callers query via
      // orchestration.taskList or orchestration.runStatus.
      coordinator.runFromExistingRun(run.id).finally(() => {
        if (activeCoordinator === coordinator) {
          activeCoordinator = null
        }
      })

      return { runId: run.id, status: 'running' }
    }
  }),

  defineMethod({
    name: 'orchestration.runStop',
    params: RunStopParams,
    handler: (_params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const run = db.getActiveCoordinatorRun()
      if (!run) {
        throw new Error('No active coordinator run')
      }

      if (activeCoordinator) {
        activeCoordinator.stop()
        activeCoordinator = null
      }

      return { runId: run.id, stopped: true }
    }
  }),

  defineMethod({
    name: 'orchestration.gateCreate',
    params: GateCreateParams,
    handler: async (
      params,
      { orchestrationCompatibilityEvidence, runtime, legacyCoordinatorRunId }
    ) => {
      const db = runtime.getOrchestrationDb()
      let options: string[] | undefined
      if (params.options) {
        try {
          const parsed = JSON.parse(params.options)
          if (!Array.isArray(parsed) || !parsed.every((option) => typeof option === 'string')) {
            throw new Error('not an array of strings')
          }
          options = parsed
        } catch {
          throw new Error('Invalid --options: must be a JSON array of strings')
        }
      }
      const task = db.getTask(params.task)
      if (!task) {
        throw new Error(`Task not found: ${params.task}`)
      }
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.from,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence
      })
      if (task.run_id !== run.id) {
        throw new OrchestrationError(
          'task_not_found',
          `Task ${params.task} was not found in Run ${run.id}.`
        )
      }
      // Resolved before createGate, which completes the task's active dispatches — afterwards the
      // member and worktree this gate is about are no longer reachable from it.
      const evaluationInput = params.evaluate
        ? await resolveGateEvaluationInput(db, runtime, {
            taskId: params.task,
            stageKey: params.stageKey ?? DEFAULT_GATE_STAGE_KEY
          })
        : null
      const gate = db.createGate({
        taskId: params.task,
        question: params.question,
        options
      })
      if (!evaluationInput) {
        return { gate }
      }
      const directory = runtime.getAlicornMemberDirectory()
      // No directory means the control plane is unconfigured: the policy cannot be read, so the
      // honest answer is a gate, not an unevaluated pass.
      const recommendation: GateDecision = directory
        ? await evaluateGateForTask(directory, evaluationInput)
        : { decision: 'gate', reason: 'unverified' }
      // Level 0 records the decision it *would* have made and still gates. Nothing in GP1
      // auto-resolves: autonomy is unlocked by evidence, and evidence only accumulates by
      // running gated. Retiring a gate is SK1's, behind the ledger's windowed track record.
      const recorded = db.setGateRecommendation(gate.id, recommendation)
      return { gate: recorded ?? gate, recommendation }
    }
  }),

  // ARCHITECTURE §8: record a named check result for a task. Written to the client's own store
  // because a gate has to decide now — the Ledger API is authoritative but eventual, and D5's
  // verification worker already mirrors its own results here on the way out.
  defineMethod({
    name: 'orchestration.verifyRecord',
    params: VerifyRecordParams,
    handler: (params, { orchestrationCompatibilityEvidence, runtime, legacyCoordinatorRunId }) => {
      const db = runtime.getOrchestrationDb()
      const task = db.getTask(params.task)
      if (!task) {
        throw new Error(`Task not found: ${params.task}`)
      }
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.from,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence
      })
      if (task.run_id !== run.id) {
        throw new OrchestrationError(
          'task_not_found',
          `Task ${params.task} was not found in Run ${run.id}.`
        )
      }
      let detail: Record<string, unknown> | null = null
      if (params.detail) {
        try {
          const parsed = JSON.parse(params.detail)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('not an object')
          }
          detail = parsed as Record<string, unknown>
        } catch {
          throw new Error('Invalid --detail: must be a JSON object')
        }
      }
      const dispatchId = params.dispatch ?? getLatestDispatchForTask(db, params.task)?.id
      if (!dispatchId) {
        throw new Error(`Task ${params.task} has no dispatch to record a check against`)
      }
      db.recordDispatchVerification({
        dispatchId,
        taskId: params.task,
        kind: params.kind ?? 'manual',
        name: params.name,
        // Default true: a check nobody marked optional is one the gate must see.
        required: params.required ?? true,
        status: params.status,
        detail
      })
      return {
        taskId: params.task,
        dispatchId,
        verifications: db.listTaskVerifications(params.task)
      }
    }
  }),

  defineMethod({
    name: 'orchestration.gateResolve',
    params: GateResolveParams,
    handler: (params, { orchestrationCompatibilityEvidence, runtime, legacyCoordinatorRunId }) => {
      const db = runtime.getOrchestrationDb()
      const existing = db.getGate(params.id)
      if (!existing) {
        throw new Error(`Gate not found: ${params.id}`)
      }
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.from,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence
      })
      // Why: a gate outside the caller's Run is indistinguishable from a missing one, so probing cannot map foreign Runs.
      if (existing.run_id !== run.id) {
        throw new Error(`Gate not found: ${params.id}`)
      }
      const gate = db.resolveGate(params.id, params.resolution)
      if (!gate) {
        throw new Error(`Gate not found: ${params.id}`)
      }
      return { gate }
    }
  }),

  defineMethod({
    name: 'orchestration.gateList',
    params: GateListParams,
    handler: (params, { orchestrationCompatibilityEvidence, runtime, legacyCoordinatorRunId }) => {
      const db = runtime.getOrchestrationDb()
      const explicitRun = params.run ? db.getRun(params.run) : undefined
      // Why: same read posture as taskList — an explicitly named Run is inspectable, an unnamed one means the caller's own.
      const run =
        explicitRun?.legacy === 1
          ? explicitRun
          : resolveRunScope(runtime, {
              runId: params.run,
              callerTerminalHandle: params.from,
              requireCurrentConsumer: params.run === undefined,
              legacyCoordinatorRunId,
              callerEvidence: orchestrationCompatibilityEvidence
            })
      const gates = db
        .listGates({
          taskId: params.task,
          status: params.status as GateStatus
        })
        .filter((gate) => gate.run_id === run.id)
      return { runId: run.id, gates, count: gates.length }
    }
  })
]
