import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import { createTaskInRun } from '../runtime/rpc/methods/orchestration-task-internal'
import { startWorkerForTask } from '../runtime/rpc/methods/orchestration-worker-internal'
import { BOARD_LOOP_WINDOW_MS, evaluateBoardGuard, type GuardVerdict } from './board-guard-rails'
import { boardCoordinatorHandle, ensureBoardRun } from './board-system-run'
import { isBoardAutomationKilled } from './board-kill-switch'
import { renderBoardPromptTemplate, type BoardRuleStore } from './board-rule-store'
import type { WorkflowDirectory } from './workflow-directory'
import { codeStageOutcome, runCodeStage } from '../alicorn/workflows/code-stage-runner'
import { enqueueCodeStageOutcome } from '../alicorn/workflows/code-stage-outcome-enqueue'

// Why its own budget: an automated start has nobody watching it, so it waits as long as a human
// start does rather than an ad-hoc number.
const BOARD_WORKER_READINESS_TIMEOUT_MS = 120_000

export type WorkspaceStatusChange = {
  worktreeId: string
  repoId: string
  fromStatusId: string | null
  toStatusId: string
  worktreePath: string
  /** Readable id of the linked issue, when the workspace has one. For the prompt template. */
  issueRef?: string | null
  workspaceName?: string | null
}

/**
 * `skipped` is not a refusal. A column with no rule is the ordinary case, and recording it would
 * fill the transition history with noise and make the kill-switch UI read as if automation kept
 * refusing work.
 */
export type BoardDispatchResult =
  | { allow: true; dispatchId: string }
  | { allow: false; reason: 'skipped'; detail: string }
  | { allow: false; reason: 'start_failed'; detail: string }
  | { allow: false; reason: 'workflow_unavailable'; detail: string }
  | { allow: true; ranCode: { stageKey: string; exitCode: number } }
  | { allow: false; reason: 'code_failed'; detail: string }
  | { allow: false; reason: 'code_unsupported_remote'; detail: string }
  | Extract<GuardVerdict, { allow: false }>

/**
 * What the column resolved to, and who it dispatches.
 *
 * A stage wins over an ad-hoc rule: it carries `reversibility` and `inherited_cost`, which the
 * autonomy policy reads and a rule cannot express. The rule stays the fallback for a project with
 * no workflow — the pre-v1.5 shape the plan calls a degenerate one-stage workflow.
 */
type ColumnBinding =
  | { source: 'stage'; memberId: string; promptTemplate: string; ruleId: string }
  | { source: 'rule'; memberId: string; promptTemplate: string; ruleId: string }
  | { source: 'code'; command: string; ruleId: string; stageName: string }

export type BoardRuleEngineDeps = {
  runtime: OrcaRuntimeService
  getDb: () => OrchestrationDb | null
  rules: BoardRuleStore
  /** Absent before WF3 wiring; the engine then uses ad-hoc rules only. */
  workflows?: WorkflowDirectory | null
  /** Injected for tests; defaults to the real `runProcess`-backed runner. */
  runCode?: typeof runCodeStage
  /**
   * Where the workspace actually lives. A code stage runs on the local machine, so an SSH-hosted
   * workspace refuses rather than executing against a path that is not this host's. Absent (or
   * `unknown`) reads as local — see the code-stage branch.
   */
  resolveWorktreeHost?: (worktreeId: string) => Promise<'local' | 'remote' | 'unknown'>
  now?: () => number
}

export type BoardRuleEngine = {
  onWorkspaceStatusChanged: (event: WorkspaceStatusChange) => Promise<BoardDispatchResult>
}

type WorkerStartOutcome = { dispatchId?: string; failedStage?: string; lastError?: string }

/**
 * Turns a board column change into a member dispatch.
 *
 * The dispatch goes through the ordinary task-create and worker-start path rather than a private
 * one, so an automated run carries exactly the same provenance as a human's — which is the reason
 * automation routes through orchestration instead of beside it.
 */
type BindingOutcome =
  | { kind: 'bound'; binding: ColumnBinding }
  | { kind: 'none' }
  | { kind: 'unavailable'; detail: string }

// Why the stage's own key is the rule id: a transition recorded against a stage should point at the
// stage that caused it, and the stage key is what `step_outcomes.stage_key` already carries.
async function resolveColumnBinding(
  deps: BoardRuleEngineDeps,
  event: WorkspaceStatusChange
): Promise<BindingOutcome> {
  const fallback = (): BindingOutcome => {
    const rule = deps.rules.findRule(event.repoId, event.toStatusId)
    return rule
      ? {
          kind: 'bound',
          binding: {
            source: 'rule',
            memberId: rule.memberId,
            promptTemplate: rule.promptTemplate,
            ruleId: rule.id
          }
        }
      : { kind: 'none' }
  }

  if (!deps.workflows) {
    return fallback()
  }
  const resolved = await deps.workflows.resolveColumn(event.repoId, event.toStatusId)
  if (resolved.kind === 'unavailable') {
    return { kind: 'unavailable', detail: resolved.detail }
  }
  // Falls back rather than treating an unstaged column as authored silence.
  //
  // Verified against the seeded stack: WF4's template keys stages by pipeline step
  // (spec, build, review, …) while board columns are todo/in-progress/in-review/completed —
  // no overlap at all. Reading an unstaged column as "nothing happens here" therefore took
  // automation down completely and bypassed the rules that did work, rather than degrading.
  // Until a column carries an explicit stage binding, an unstaged column means "this workflow does
  // not speak for this column", which is what the rules are for.
  if (resolved.kind === 'no-stage') {
    return fallback()
  }
  if (resolved.kind === 'none') {
    return fallback()
  }
  const stage = resolved.stage
  // A code stage runs a command instead of dispatching anybody: deterministic work must never be
  // routed through a model (GRAPH-ENGINEERING, WF5).
  if (stage.kind === 'code') {
    return stage.codeCommand
      ? {
          kind: 'bound',
          binding: {
            source: 'code',
            command: stage.codeCommand,
            ruleId: stage.key,
            stageName: stage.name
          }
        }
      : { kind: 'none' }
  }
  // A stage with no member is a human step — Merge and Deploy in the shipped template — so it
  // dispatches nobody rather than falling back to a rule that would.
  if (!stage.memberId) {
    return { kind: 'none' }
  }
  // WF1 stages carry no brief: they hold the member and the attributes the autonomy policy reads.
  // So the stage supplies who runs, and the column's rule still supplies what to say when one
  // exists. Without it, a plain default names the stage rather than inventing instructions.
  const template =
    deps.rules.findRule(event.repoId, event.toStatusId)?.promptTemplate ??
    `${stage.name} {{worktree}}.`
  return {
    kind: 'bound',
    binding: {
      source: 'stage',
      memberId: stage.memberId,
      promptTemplate: template,
      ruleId: stage.key
    }
  }
}

export function createBoardRuleEngine(deps: BoardRuleEngineDeps): BoardRuleEngine {
  const now = deps.now ?? Date.now

  return {
    onWorkspaceStatusChanged: async (event) => {
      const db = deps.getDb()
      if (!db) {
        return { allow: false, reason: 'skipped', detail: 'Orchestration is not available.' }
      }
      const binding = await resolveColumnBinding(deps, event)
      if (binding.kind === 'unavailable') {
        // Why refuse rather than fall back: without the stage we would be guessing at
        // `reversibility`, which ARCHITECTURE §7 says is authored and never inferred.
        return {
          allow: false,
          reason: 'workflow_unavailable',
          detail: `The workflow for this project could not be read: ${binding.detail}`
        }
      }
      if (binding.kind === 'none') {
        return {
          allow: false,
          reason: 'skipped',
          detail: 'No stage or enabled rule for this column.'
        }
      }
      const rule = binding.binding

      const killed = isBoardAutomationKilled(db, event.repoId)

      // One read covers both guards: the loop window is the wider of the two.
      const transitions = db.listBoardTransitions(event.worktreeId, now() - BOARD_LOOP_WINDOW_MS)
      const verdict = evaluateBoardGuard({
        now: now(),
        transitions,
        toStatusId: event.toStatusId,
        killed
      })
      const record = (
        outcome: 'dispatched' | 'refused_ceiling' | 'refused_loop' | 'refused_killed',
        ids: { taskId?: string; dispatchId?: string } = {}
      ): void => {
        db.recordBoardTransition({
          repoId: event.repoId,
          worktreeId: event.worktreeId,
          fromStatusId: event.fromStatusId,
          toStatusId: event.toStatusId,
          ruleId: rule.ruleId,
          outcome,
          ...ids
        })
      }

      if (!verdict.allow) {
        record(
          verdict.reason === 'ceiling'
            ? 'refused_ceiling'
            : verdict.reason === 'loop'
              ? 'refused_loop'
              : 'refused_killed'
        )
        return verdict
      }

      // A code stage runs here and dispatches nobody: deterministic work must never be routed
      // through a model, and running it inline keeps the board move as its only trigger.
      if (rule.source === 'code') {
        // `worktreePath` is a path on the *execution* host. Running the command locally for an SSH
        // workspace either fails outright or — worse — finds a same-named local directory and
        // reports success for work that never touched the real workspace. `unknown` reads as local,
        // matching the diff-coverage runner: refusing every stage the moment the runtime hiccups
        // would be worse than running where we already are. Nothing is recorded, so a refused stage
        // costs the workspace none of its dispatch ceiling.
        if ((await deps.resolveWorktreeHost?.(event.worktreeId)) === 'remote') {
          return {
            allow: false,
            reason: 'code_unsupported_remote',
            detail: `${rule.stageName} runs a command, and this workspace is on a remote host.`
          }
        }
        // The same Run and task-create path a dispatched member takes: a code stage is a step in
        // the ledger like any other, and a step needs a run and a task to hang on.
        const codeRun = ensureBoardRun(db, event.repoId)
        const codeTask = createTaskInRun(deps.runtime, codeRun, {
          spec: `${rule.stageName}: ${rule.command}`,
          executionStrategy: 'single'
        })
        const outcome = await (deps.runCode ?? runCodeStage)({
          worktreePath: event.worktreePath,
          command: rule.command
        })
        const { dispatchId: codeDispatchId } = enqueueCodeStageOutcome(db, {
          runId: codeRun.id,
          taskId: codeTask.id,
          stageKey: rule.ruleId,
          // A board's repo is its project — the same fallback the worker path's worktree read makes.
          projectId: event.repoId,
          repoId: event.repoId,
          worktreeId: event.worktreeId,
          result: outcome
        })
        record('dispatched', { taskId: codeTask.id, dispatchId: codeDispatchId })
        return codeStageOutcome(outcome) === 'succeeded'
          ? { allow: true, ranCode: { stageKey: rule.ruleId, exitCode: outcome.exitCode } }
          : {
              allow: false,
              reason: 'code_failed',
              detail:
                outcome.stderrTail.trim() ||
                outcome.stdoutTail.trim() ||
                `${rule.stageName} exited ${outcome.exitCode}.`
            }
      }

      const run = ensureBoardRun(db, event.repoId)
      const task = createTaskInRun(deps.runtime, run, {
        spec: renderBoardPromptTemplate(rule.promptTemplate, {
          worktree: event.workspaceName ?? event.worktreeId,
          worktreePath: event.worktreePath,
          issue: event.issueRef,
          status: event.toStatusId
        }),
        // Why single: automation dispatches one member for one column. `orchestrated` stays a
        // deliberate human choice (PROJECT-BRIEF §04).
        executionStrategy: 'single'
      })

      const started = (await startWorkerForTask({
        runtime: deps.runtime,
        db,
        run,
        task,
        params: {
          task: task.id,
          from: run.coordinator_handle ?? boardCoordinatorHandle(event.repoId),
          worktree: `id:${event.worktreeId}`,
          member: rule.memberId
        },
        readinessTimeoutMs: BOARD_WORKER_READINESS_TIMEOUT_MS,
        // Why: the board's Run has no live coordinator pane; its authority is the Run it owns.
        coordinatorTerminal: 'absent'
      })) as WorkerStartOutcome

      // Why failedStage and not a missing dispatchId: a failed start returns its receipt with the
      // dispatch id still on it, so keying on the id would read every failure as a success.
      if (started.failedStage || !started.dispatchId) {
        record('refused_killed', {
          taskId: task.id,
          ...(started.dispatchId ? { dispatchId: started.dispatchId } : {})
        })
        return {
          allow: false,
          reason: 'start_failed',
          detail: started.lastError ?? 'Worker start did not produce a dispatch.'
        }
      }

      record('dispatched', { taskId: task.id, dispatchId: started.dispatchId })
      return { allow: true, dispatchId: started.dispatchId }
    }
  }
}
