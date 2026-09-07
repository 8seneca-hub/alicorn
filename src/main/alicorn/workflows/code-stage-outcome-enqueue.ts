import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { StepOutcomeInput } from '../../../shared/alicorn/ledger-inputs'
import { codeStageOutcome, type CodeStageResult } from './code-stage-runner'

const REPORT_SUMMARY_MAX_CHARS = 4000

/** Outbox payload for a code stage: the whole input, already built — nothing to resolve later. */
export type CodeStagePayload = { source: 'code'; outcome: StepOutcomeInput }

export function isCodeStagePayload(payload: unknown): payload is CodeStagePayload {
  return (payload as CodeStagePayload | null)?.source === 'code'
}

export type CodeStageOutcomeInput = {
  runId: string
  taskId: string
  stageKey: string
  result: CodeStageResult
  projectId?: string
  repoId?: string
  worktreeId?: string
  branch?: string
}

/**
 * The dispatch id a code stage is recorded under.
 *
 * A code stage dispatches nobody, so there is no dispatch row to point at — but the ledger's
 * uniqueness is `(tenant, run, task, stage_key, dispatch_id)` and the column is NOT NULL. The task
 * is created per execution, so deriving the id from it is unique per run of the stage and is
 * visibly synthetic rather than looking like a worker's dispatch.
 */
export function codeStageDispatchId(taskId: string): string {
  return `code-${taskId}`
}

export function buildCodeStageOutcome(input: CodeStageOutcomeInput): StepOutcomeInput {
  const outcome = codeStageOutcome(input.result)
  // stdout is what a passing stage has to say; a failed one usually says it on stderr, and
  // recording an empty summary for the case a human most needs to read would be the wrong trade.
  const summary =
    outcome === 'succeeded'
      ? input.result.stdoutTail
      : input.result.stderrTail || input.result.stdoutTail
  return {
    runId: input.runId,
    taskId: input.taskId,
    dispatchId: codeStageDispatchId(input.taskId),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.repoId ? { repoId: input.repoId } : {}),
    ...(input.worktreeId ? { worktreeId: input.worktreeId } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
    // No memberId at all: a code stage has no member, and a null one would read as
    // "member with no id" rather than "never had one".
    backend: 'code',
    stageKey: input.stageKey.slice(0, 64),
    // Automation dispatches one step for one column; `orchestrated` stays a human choice.
    executionStrategy: 'single',
    outcome,
    // A code stage may well change files, but nothing here computes a diff — an empty list is
    // honest where a guess would corrupt the measurement the ledger exists for.
    filesModified: [],
    reportSummary: summary.slice(0, REPORT_SUMMARY_MAX_CHARS),
    // Neither applies to a step with no model behind it; both are recorded as false rather than
    // omitted so a reader never has to wonder whether they were simply not measured.
    reviewBackendBypass: false,
    escalationOffered: false,
    escalationAccepted: null,
    clientTs: new Date().toISOString()
  }
}

/**
 * Records a code stage's step outcome through the outbox.
 *
 * Never throws, and never posts directly: a settlement path that `fetch`es the Ledger API can lose
 * a step to a crash between the two, which is the whole reason the outbox exists.
 */
export function enqueueCodeStageOutcome(
  db: OrchestrationDb,
  input: CodeStageOutcomeInput
): { dispatchId: string } {
  const dispatchId = codeStageDispatchId(input.taskId)
  try {
    // Why the `step_outcome` kind and not one of its own: this *is* a step outcome, bound for the
    // same endpoint. `ledger_outbox.kind` is a CHECK constraint, so a new value would mean
    // rebuilding a table that holds unsent rows — a migration bought for nothing. The payload
    // carries `source` so the drainer can tell a code stage's fully-built input from a worker's
    // settlement receipt, which it still has to resolve at drain time.
    db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: `step_outcome:${dispatchId}`,
      payload: { source: 'code', outcome: buildCodeStageOutcome(input) } satisfies CodeStagePayload
    })
  } catch (error) {
    console.warn(
      '[alicorn] code stage outcome not enqueued',
      dispatchId,
      error instanceof Error ? error.message : String(error)
    )
  }
  return { dispatchId }
}
