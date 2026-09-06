import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db'
import { createTaskInRun } from '../runtime/rpc/methods/orchestration-task-internal'
import { startWorkerForTask } from '../runtime/rpc/methods/orchestration-worker-internal'
import { BOARD_LOOP_WINDOW_MS, evaluateBoardGuard, type GuardVerdict } from './board-guard-rails'
import { boardCoordinatorHandle, ensureBoardRun } from './board-system-run'
import { isBoardAutomationKilled } from './board-kill-switch'
import { renderBoardPromptTemplate, type BoardRuleStore } from './board-rule-store'

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
  | Extract<GuardVerdict, { allow: false }>

export type BoardRuleEngineDeps = {
  runtime: OrcaRuntimeService
  getDb: () => OrchestrationDb | null
  rules: BoardRuleStore
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
export function createBoardRuleEngine(deps: BoardRuleEngineDeps): BoardRuleEngine {
  const now = deps.now ?? Date.now

  return {
    onWorkspaceStatusChanged: async (event) => {
      const db = deps.getDb()
      if (!db) {
        return { allow: false, reason: 'skipped', detail: 'Orchestration is not available.' }
      }
      const rule = deps.rules.findRule(event.repoId, event.toStatusId)
      if (!rule) {
        return { allow: false, reason: 'skipped', detail: 'No enabled rule for this column.' }
      }

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
          ruleId: rule.id,
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
