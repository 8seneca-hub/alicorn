import type { OrchestrationDb } from '../runtime/orchestration/db'
import type {
  LedgerOutboxKind,
  LedgerOutboxRow
} from '../runtime/orchestration/db/alicorn/alicorn-rows'
import { buildStepOutcomeInput } from './step-outcome-builder'
import { isCodeStagePayload, type CodeStagePayload } from './workflows/code-stage-outcome-enqueue'
import { settleOutboxRow } from './outbox-row-processing'
import type { LedgerWriter } from './ledger/ledger-writer'
import type {
  ContextCaptureInput,
  HumanVerdictPatch,
  InterruptionInput,
  SpendPatch
} from '../../shared/alicorn/ledger-inputs'

// Why 60s: transcripts (spend usage) flush after the report lands, not before.
const SPEND_ATTRIBUTION_DELAY_MS = 60_000
// Exported: the verification worker (LG2a) reuses this so its own pause-on-stop_pass
// window can't drift from the drainer's throttle window.
export const UNAVAILABLE_LOG_INTERVAL_MS = 5 * 60_000

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

// Exported: the verification worker (LG2a) parses the same shape off the rows this
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

export type LedgerOutboxDrainerDeps = {
  getDb: () => OrchestrationDb
  runtime: { showManagedWorktree: (selector: string) => Promise<DrainerWorktree> }
  writer: LedgerWriter | null
  // Why null for now: C5 (attributeDispatchUsage) isn't written yet.
  spendAttributor: SpendAttributor | null
  intervalMs: number
  excludeKinds?: LedgerOutboxKind[]
}

export type LedgerOutboxDrainer = {
  stop(): void
  drainOnce(): Promise<{ sent: number; retried: number; dead: number }>
}

/** Marker thrown to short-circuit a pass without bumping attempts or logging as a failure. */
class RowUntouched extends Error {}

export function startLedgerOutboxDrainer(deps: LedgerOutboxDrainerDeps): LedgerOutboxDrainer {
  let lastUnavailableLogAt = 0
  let lastThrottledWarnAt = 0
  let running = false

  function logUnavailableOnce(): void {
    const now = Date.now()
    if (now - lastUnavailableLogAt >= UNAVAILABLE_LOG_INTERVAL_MS) {
      lastUnavailableLogAt = now
      console.warn('[ledger-outbox] control plane unconfigured; rows left untouched')
    }
  }

  function warn(message: string, detail: Record<string, unknown>): void {
    console.warn(message, detail)
  }

  // Why `force` is passed in, not inferred: a row's first failure must always log even
  // inside the throttle window, and the caller (settleOutboxRow) knows that directly —
  // reading it back out of a `detail.attempts` field it happens to populate is an
  // undeclared cross-file convention that breaks silently if that field is ever dropped.
  function throttledWarn(
    message: string,
    detail: Record<string, unknown>,
    options?: { force?: boolean }
  ): void {
    const now = Date.now()
    if (!options?.force && now - lastThrottledWarnAt < UNAVAILABLE_LOG_INTERVAL_MS) {
      return
    }
    lastThrottledWarnAt = now
    console.warn(message, detail)
  }

  const rowSettlementDeps = { now: () => Date.now(), warn, throttledWarn }

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
    const parsed = JSON.parse(row.payload) as StepOutcomePayload | CodeStagePayload
    // A code stage's input is complete at enqueue time: it has no dispatch to resolve a worktree
    // or a member from, no model spend to attribute, and no member diff to run coverage over.
    if (isCodeStagePayload(parsed)) {
      await writer.postStepOutcome(parsed.outcome)
      settleOutboxRow(db, row, { kind: 'sent' }, rowSettlementDeps)
      return
    }
    const payload = parsed
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
    settleOutboxRow(db, row, { kind: 'sent' }, rowSettlementDeps)
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
    settleOutboxRow(db, row, { kind: 'sent' }, rowSettlementDeps)
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
    settleOutboxRow(db, row, { kind: 'sent' }, rowSettlementDeps)
  }

  async function handleInterruption(
    db: OrchestrationDb,
    row: LedgerOutboxRow,
    writer: LedgerWriter
  ): Promise<void> {
    const payload = JSON.parse(row.payload) as InterruptionInput
    await writer.postInterruption(payload)
    settleOutboxRow(db, row, { kind: 'sent' }, rowSettlementDeps)
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
        // Owned by the verification worker (LG2a); production wiring excludes this kind
        // from this drainer's fetch. Reachable only if a caller omits excludeKinds.
        throw new RowUntouched()
      case 'human_verdict_patch':
        return handleHumanVerdictPatch(db, row, writer)
      case 'interruption':
        return handleInterruption(db, row, writer)
    }
  }

  async function drainOnce(): Promise<{ sent: number; retried: number; dead: number }> {
    // Why a top-level check (not a per-row RowUntouched): a null writer is a global
    // condition like ControlPlaneUnavailableError, not a per-kind gap — it stops the
    // whole pass and logs, rather than being skipped row by row.
    if (!deps.writer) {
      logUnavailableOnce()
      return { sent: 0, retried: 0, dead: 0 }
    }
    const writer = deps.writer
    const db = deps.getDb()
    const rows = db.listDueLedgerOutbox(25, undefined, { excludeKinds: deps.excludeKinds })
    let sent = 0
    let retried = 0
    let dead = 0
    for (const row of rows) {
      try {
        await processRow(db, row, writer)
        sent += 1
      } catch (error) {
        if (error instanceof RowUntouched) {
          continue
        }
        const settled = settleOutboxRow(db, row, { kind: 'failed', error }, rowSettlementDeps)
        if (settled === 'stop_pass') {
          break
        }
        if (settled === 'dead') {
          dead += 1
        } else {
          retried += 1
        }
      }
    }
    return { sent, retried, dead }
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
