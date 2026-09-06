import type { OrchestrationDb } from '../runtime/orchestration/db'
import type { LedgerOutboxRow } from '../runtime/orchestration/db/alicorn/alicorn-rows'
import { buildStepOutcomeInput } from './step-outcome-builder'
import { ControlPlaneUnavailableError } from './control-plane-http'
import type { LedgerWriter } from './ledger/ledger-writer'
import type {
  ContextCaptureInput,
  HumanVerdictPatch,
  InterruptionInput,
  SpendPatch
} from '../../shared/alicorn/ledger-inputs'

const BASE_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 5 * 60_000
// Why 60s: transcripts (spend usage) flush after the report lands, not before.
const SPEND_ATTRIBUTION_DELAY_MS = 60_000
const UNAVAILABLE_LOG_INTERVAL_MS = 5 * 60_000

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempts)
}

type StepOutcomePayload = {
  taskId: string
  dispatchId: string
  outcome: 'succeeded' | 'failed'
  result: string
}

type SpendAttributionPayload = {
  dispatchId: string
  taskId: string
  outcomeId: string
  backend: string
  worktreeId: string | null
  startedAt: string | null
  completedAt: string | null
}

type StepVerificationPayload = {
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

export type VerificationRunner = (
  payload: StepVerificationPayload,
  writer: LedgerWriter
) => Promise<void>

export type DrainerWorktree = {
  id: string
  path: string
  branch: string
  repoId: string
  projectId?: string
}

export type LedgerOutboxDrainerDeps = {
  getDb: () => OrchestrationDb
  runtime: { showManagedWorktree: (selector: string) => Promise<DrainerWorktree> }
  writer: LedgerWriter | null
  // Why null for now: C5 (attributeDispatchUsage) and D5 (runDiffCoverageCheck) aren't written yet.
  spendAttributor: SpendAttributor | null
  verificationRunner: VerificationRunner | null
  intervalMs: number
}

export type LedgerOutboxDrainer = {
  stop(): void
  drainOnce(): Promise<{ sent: number; failed: number }>
}

/** Marker thrown to short-circuit a pass without bumping attempts or logging as a failure. */
class RowUntouched extends Error {}

export function startLedgerOutboxDrainer(deps: LedgerOutboxDrainerDeps): LedgerOutboxDrainer {
  let lastUnavailableLogAt = 0
  let lastRowFailureLogAt = 0
  let running = false

  function logUnavailableOnce(): void {
    const now = Date.now()
    if (now - lastUnavailableLogAt >= UNAVAILABLE_LOG_INTERVAL_MS) {
      lastUnavailableLogAt = now
      console.warn('[ledger-outbox] control plane unconfigured; rows left untouched')
    }
  }

  // Why a row's first failure always logs: attempts === 0 means nothing has
  // warned about it yet, so the shared 5-minute throttle must not hide it.
  function logRowFailure(row: LedgerOutboxRow, message: string): void {
    const now = Date.now()
    if (row.attempts > 0 && now - lastRowFailureLogAt < UNAVAILABLE_LOG_INTERVAL_MS) {
      return
    }
    lastRowFailureLogAt = now
    console.warn('[ledger-outbox] row failed', {
      id: row.id,
      kind: row.kind,
      attempts: row.attempts,
      message
    })
  }

  async function resolveWorktree(
    db: OrchestrationDb,
    dispatchId: string
  ): Promise<DrainerWorktree | null> {
    const worktreeId = db.getWorkerDispatch(dispatchId)?.worktree_id
    if (!worktreeId) {
      return null
    }
    try {
      return await deps.runtime.showManagedWorktree(`id:${worktreeId}`)
    } catch {
      return null
    }
  }

  async function handleStepOutcome(
    db: OrchestrationDb,
    row: LedgerOutboxRow,
    writer: LedgerWriter
  ): Promise<void> {
    const payload = JSON.parse(row.payload) as StepOutcomePayload
    const worktree = await resolveWorktree(db, payload.dispatchId)
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
          dedupeKey: `step_verification:${payload.dispatchId}:diff_coverage`,
          payload: verificationPayload
        })
      }
      db.db.exec('COMMIT')
    } catch (error) {
      db.db.exec('ROLLBACK')
      throw error
    }
  }

  async function handleContextCapture(
    db: OrchestrationDb,
    row: LedgerOutboxRow,
    writer: LedgerWriter
  ): Promise<void> {
    const payload = JSON.parse(row.payload) as ContextCaptureInput
    await writer.postContextCapture(payload)
    db.markLedgerOutboxSent(row.id)
  }

  async function handleSpendAttribution(
    db: OrchestrationDb,
    row: LedgerOutboxRow,
    writer: LedgerWriter
  ): Promise<void> {
    if (!deps.spendAttributor) {
      throw new RowUntouched()
    }
    const payload = JSON.parse(row.payload) as SpendAttributionPayload
    const patch = await deps.spendAttributor({
      backend: payload.backend,
      worktreeId: payload.worktreeId,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt
    })
    await writer.patchStepOutcomeSpend(payload.outcomeId, patch)
    db.markLedgerOutboxSent(row.id)
  }

  async function handleStepVerification(
    db: OrchestrationDb,
    row: LedgerOutboxRow,
    writer: LedgerWriter
  ): Promise<void> {
    if (!deps.verificationRunner) {
      throw new RowUntouched()
    }
    const payload = JSON.parse(row.payload) as StepVerificationPayload
    await deps.verificationRunner(payload, writer)
    db.markLedgerOutboxSent(row.id)
  }

  async function handleHumanVerdictPatch(
    db: OrchestrationDb,
    row: LedgerOutboxRow,
    writer: LedgerWriter
  ): Promise<void> {
    const { outcomeId, ...patch } = JSON.parse(row.payload) as {
      outcomeId: string
    } & HumanVerdictPatch
    await writer.patchHumanVerdict(outcomeId, patch)
    db.markLedgerOutboxSent(row.id)
  }

  async function handleInterruption(
    db: OrchestrationDb,
    row: LedgerOutboxRow,
    writer: LedgerWriter
  ): Promise<void> {
    const payload = JSON.parse(row.payload) as InterruptionInput
    await writer.postInterruption(payload)
    db.markLedgerOutboxSent(row.id)
  }

  async function processRow(
    db: OrchestrationDb,
    row: LedgerOutboxRow,
    writer: LedgerWriter
  ): Promise<void> {
    switch (row.kind) {
      case 'step_outcome':
        return handleStepOutcome(db, row, writer)
      case 'context_capture':
        return handleContextCapture(db, row, writer)
      case 'spend_attribution':
        return handleSpendAttribution(db, row, writer)
      case 'step_verification':
        return handleStepVerification(db, row, writer)
      case 'human_verdict_patch':
        return handleHumanVerdictPatch(db, row, writer)
      case 'interruption':
        return handleInterruption(db, row, writer)
    }
  }

  async function drainOnce(): Promise<{ sent: number; failed: number }> {
    // Why a top-level check (not a per-row RowUntouched): a null writer is a global
    // condition like ControlPlaneUnavailableError, not a per-kind gap — it stops the
    // whole pass and logs, rather than being skipped row by row.
    if (!deps.writer) {
      logUnavailableOnce()
      return { sent: 0, failed: 0 }
    }
    const writer = deps.writer
    const db = deps.getDb()
    const rows = db.listDueLedgerOutbox(25)
    let sent = 0
    let failed = 0
    for (const row of rows) {
      try {
        await processRow(db, row, writer)
        sent += 1
      } catch (error) {
        if (error instanceof RowUntouched) {
          continue
        }
        if (error instanceof ControlPlaneUnavailableError) {
          logUnavailableOnce()
          break
        }
        const message = error instanceof Error ? error.message : String(error)
        logRowFailure(row, message)
        db.markLedgerOutboxFailed(
          row.id,
          message,
          new Date(Date.now() + backoffMs(row.attempts)).toISOString()
        )
        failed += 1
      }
    }
    return { sent, failed }
  }

  const timer = setInterval(() => {
    if (running) {
      return
    }
    running = true
    drainOnce()
      .catch((error) => console.error('[ledger-outbox] drain pass failed:', error))
      .finally(() => {
        running = false
      })
  }, deps.intervalMs)

  return {
    stop() {
      clearInterval(timer)
    },
    drainOnce
  }
}
