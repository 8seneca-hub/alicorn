import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { LedgerOutboxRow } from '../runtime/orchestration/db/alicorn/alicorn-rows'
import { buildStepOutcomeInput } from './step-outcome-builder'
import { isCodeStagePayload, type CodeStagePayload } from './workflows/code-stage-outcome-enqueue'
import { settleOutboxRow, type OutboxRowSettlementDeps } from './outbox-row-processing'
import type { LedgerWriter } from './ledger/ledger-writer'
import type { SpendPatch } from '../../shared/alicorn/ledger-inputs'

// Why 60s: transcripts (spend usage) flush after the report lands, not before.
const SPEND_ATTRIBUTION_DELAY_MS = 60_000

export type StepOutcomePayload = {
  taskId: string
  dispatchId: string
  outcome: 'succeeded' | 'failed'
  result: string
}

export type SpendAttributionPayload = {
  dispatchId: string
  taskId: string
  outcomeId: string
  backend: string
  worktreeId: string | null
  startedAt: string | null
  completedAt: string | null
}

// Exported: the verification worker (LG2a) parses the same shape off the rows the
// drainer enqueues, without owning the step_verification handling itself.
export type StepVerificationPayload = {
  dispatchId: string
  taskId: string
  runId: string
  worktreeId: string
  worktreePath: string
  branch: string
  projectId: string
}

export type SpendAttributor = (input: {
  backend: string
  worktreeId: string | null
  startedAt: string | null
  completedAt: string | null
}) => Promise<SpendPatch>

export type DrainerWorktree = {
  id: string
  path: string
  branch: string
  repoId: string
  projectId?: string
}

export async function handleStepOutcomeRow(
  db: OrchestrationDb,
  row: LedgerOutboxRow,
  writer: LedgerWriter,
  context: {
    resolveWorktree: (db: OrchestrationDb, dispatchId: string) => Promise<DrainerWorktree | null>
    settlement: OutboxRowSettlementDeps
  }
): Promise<void> {
  const parsed = JSON.parse(row.payload) as StepOutcomePayload | CodeStagePayload
  // A code stage's input is complete at enqueue time: it has no dispatch to resolve a worktree
  // or a member from, no model spend to attribute, and no member diff to run coverage over.
  if (isCodeStagePayload(parsed)) {
    await writer.postStepOutcome(parsed.outcome)
    settleOutboxRow(db, row, { kind: 'sent' }, context.settlement)
    return
  }
  const payload = parsed
  const worktree = await context.resolveWorktree(db, payload.dispatchId)
  const stepOutcomeInput = buildStepOutcomeInput({ db, payload, worktree })
  const posted = await writer.postStepOutcome(stepOutcomeInput)

  const dispatchContext = db.getDispatchContextById(payload.dispatchId)
  const spendPayload: SpendAttributionPayload = {
    dispatchId: payload.dispatchId,
    taskId: payload.taskId,
    outcomeId: posted.id,
    backend: stepOutcomeInput.backend,
    worktreeId: worktree?.id ?? null,
    startedAt: dispatchContext?.dispatched_at ?? null,
    completedAt: dispatchContext?.completed_at ?? null
  }
  // Why one transaction: a crash between marking this row sent and enqueueing
  // its follow-ups must not resurrect it for a duplicate postStepOutcome.
  db.db.exec('BEGIN IMMEDIATE')
  try {
    db.markLedgerOutboxSent(row.id)
    db.setDispatchLedgerOutcome(payload.dispatchId, posted.id, stepOutcomeInput.filesModified)
    db.enqueueLedgerOutbox({
      kind: 'spend_attribution',
      dedupeKey: `spend_attribution:${payload.dispatchId}`,
      payload: spendPayload,
      notBefore: new Date(Date.now() + SPEND_ATTRIBUTION_DELAY_MS).toISOString()
    })

    if (payload.outcome === 'succeeded' && worktree) {
      const verificationPayload: StepVerificationPayload = {
        dispatchId: payload.dispatchId,
        taskId: payload.taskId,
        runId: stepOutcomeInput.runId,
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        branch: worktree.branch,
        projectId: worktree.projectId ?? worktree.repoId
      }
      db.enqueueLedgerOutbox({
        kind: 'step_verification',
        // One verification row per dispatch, covering every check the project authored — not
        // coverage alone, which is what the old `:diff_coverage` suffix claimed (ALC-113).
        dedupeKey: `step_verification:${payload.dispatchId}`,
        payload: verificationPayload
      })
    }
    db.db.exec('COMMIT')
  } catch (error) {
    db.db.exec('ROLLBACK')
    throw error
  }
}
