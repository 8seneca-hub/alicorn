import type { OrchestrationDb } from '../runtime/orchestration/db'
import type {
  LedgerOutboxKind,
  LedgerOutboxRow
} from '../runtime/orchestration/db/alicorn/alicorn-rows'
import { settleOutboxRow } from './outbox-row-processing'
import {
  handleStepOutcomeRow,
  type DrainerWorktree,
  type SpendAttributionPayload,
  type SpendAttributor
} from './ledger-outbox-step-outcome'
import type { LedgerWriter } from './ledger/ledger-writer'
import type { GateAgreementOutboxPayload } from './gates/gate-agreement'
import type { ContextCaptureInput, InterruptionInput } from '../../shared/alicorn/ledger-inputs'
import type { HumanVerdictOutboxPayload } from './corrections/human-verdict-outbox-payload'
import { proposeRuleForVerdict } from './corrections/rule-proposal-from-verdict'
import type { RuleProposalInput } from '../../shared/alicorn/rule-proposals'

export type {
  DrainerWorktree,
  SpendAttributor,
  StepVerificationPayload
} from './ledger-outbox-step-outcome'
// Exported: the verification worker (LG2a) reuses this so its own pause-on-stop_pass
// window can't drift from the drainer's throttle window.
export const UNAVAILABLE_LOG_INTERVAL_MS = 5 * 60_000

export type LedgerOutboxDrainerDeps = {
  getDb: () => OrchestrationDb
  runtime: { showManagedWorktree: (selector: string) => Promise<DrainerWorktree> }
  writer: LedgerWriter | null
  // Why null for now: C5 (attributeDispatchUsage) isn't written yet.
  spendAttributor: SpendAttributor | null
  /**
   * RB1's second consumer of the same verdict event. Null leaves the ledger patch untouched and
   * simply proposes nothing — the Rulebook is never allowed to hold up a measurement write.
   */
  proposeRule?: ((input: RuleProposalInput) => Promise<unknown>) | null
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
    await handleStepOutcomeRow(db, row, writer, {
      resolveWorktree,
      settlement: rowSettlementDeps
    })
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
    const payload = JSON.parse(row.payload) as HumanVerdictOutboxPayload
    const { outcomeId, memberId: _memberId, ruleContext: _ruleContext, ...patch } = payload
    await writer.patchHumanVerdict(outcomeId, patch)
    await proposeRuleForVerdict(payload, deps.proposeRule, warn)
    settleOutboxRow(db, row, { kind: 'sent' }, rowSettlementDeps)
  }

  /**
   * GP3. The payload names a dispatch, not a ledger id: the gate usually resolves while the
   * step outcome is still in flight. An outcome the drainer has not posted yet leaves the row
   * untouched to be retried next pass — the same posture the corrections sweep takes — rather
   * than failing it towards the dead letter for a race that resolves itself in seconds.
   */
  async function handleGateAgreementPatch(
    db: OrchestrationDb,
    row: LedgerOutboxRow,
    writer: LedgerWriter
  ): Promise<void> {
    const { dispatchId, ...patch } = JSON.parse(row.payload) as GateAgreementOutboxPayload
    const outcomeId = db.getDispatchLedgerOutcome(dispatchId)
    if (!outcomeId) {
      throw new RowUntouched()
    }
    await writer.patchGateAgreement(outcomeId, patch)
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
      case 'gate_agreement_patch':
        return handleGateAgreementPatch(db, row, writer)
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
