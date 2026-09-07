import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { parseSqliteUtc } from '../run-usage-attribution'

const ERROR_LOG_THROTTLE_MS = 5 * 60_000
let lastErrorLogAt = 0

// Why: SQLite's datetime('now') has no zone marker; the outbox wire payload needs true ISO.
// Why null, not epoch, on failure: falsifying a timestamp in an append-only ledger is worse
// than skipping the row — the caller logs and drops it instead of writing bad data.
function toIso(sqliteUtc: string): string | null {
  const ms = parseSqliteUtc(sqliteUtc)
  return ms === null ? null : new Date(ms).toISOString()
}

export type DispatchInterruptionIds = { runId: string; taskId: string; dispatchId: string }

type InterruptionKind = 'gate' | 'ask' | 'escalation'

type GateRow = { id: string; created_at: string }
type AskRow = { message_id: string; created_at: string }
type EscalationRow = { escalation_offered_at: string | null }

function enqueueOne(
  db: OrchestrationDb,
  ids: DispatchInterruptionIds,
  kind: InterruptionKind,
  sourceId: string,
  occurredAtSqliteUtc: string
): number {
  const occurredAt = toIso(occurredAtSqliteUtc)
  if (occurredAt === null) {
    logCaptureErrorThrottled(
      ids.dispatchId,
      new Error(`unparseable occurredAt for ${kind}:${sourceId}: ${occurredAtSqliteUtc}`)
    )
    return 0
  }
  const { duplicate } = db.enqueueLedgerOutbox({
    kind: 'interruption',
    dedupeKey: `interruption:${kind}:${sourceId}`,
    payload: {
      runId: ids.runId,
      taskId: ids.taskId,
      dispatchId: ids.dispatchId,
      kind,
      sourceId,
      resolvedBy: null,
      occurredAt
    }
  })
  return duplicate ? 0 : 1
}

// LC-R9: a gate ends the dispatch that raised it (createGate completes the active one), so a
// gate/ask/escalation between two dispatches belongs to neither's own [dispatched_at, completed_at]
// span. The metric is per completed task, not per dispatch — which dispatch carries the row only
// decides the stage attribution — so everything since the task's last settled dispatch (or its
// creation, if this is the first) up to this dispatch's completion is attributed here.
function windowStart(
  db: OrchestrationDb,
  ids: DispatchInterruptionIds,
  end: string
): string | null {
  // Why completed_at <= end: without this bound, a sibling dispatch settling later (after this
  // one) would make this window's start > end and silently match nothing.
  const prev = db.db
    .prepare(
      `SELECT completed_at FROM dispatch_contexts
       WHERE task_id = ? AND id != ? AND completed_at IS NOT NULL AND completed_at <= ?
       ORDER BY completed_at DESC LIMIT 1`
    )
    .get(ids.taskId, ids.dispatchId, end) as { completed_at: string } | undefined
  return prev?.completed_at ?? db.getTask(ids.taskId)?.created_at ?? null
}

function enqueueInterruptions(db: OrchestrationDb, ids: DispatchInterruptionIds): number {
  const dispatch = db.getDispatchContextById(ids.dispatchId)
  if (!dispatch?.completed_at) {
    return 0
  }
  const end = dispatch.completed_at
  const start = windowStart(db, ids, end)
  if (start === null) {
    return 0
  }
  let enqueued = 0

  // Why inclusive at both ends, not the open-below (prevCompletedAt, end] of the ruling: SQLite
  // datetime('now') has 1-second resolution, so an event stamped in the same second as the
  // previous dispatch's completed_at is indistinguishable from one that landed exactly on it —
  // an open lower bound would silently drop it. Inclusive-both is safe only when sourceId is
  // entity-invariant (gate.id, message_id) — a boundary-second event then dedupes to one row
  // regardless of which dispatch's capture finds it first. This is why escalation below keys on
  // taskId rather than dispatchId: alicorn_task_strategy has one row per task, not per dispatch,
  // so dispatchId as sourceId would let the same offer land twice under two different keys.
  const gates = db.db
    .prepare(
      `SELECT id, created_at FROM decision_gates WHERE task_id = ? AND created_at BETWEEN ? AND ?`
    )
    .all(ids.taskId, start, end) as GateRow[]
  for (const gate of gates) {
    enqueued += enqueueOne(db, ids, 'gate', gate.id, gate.created_at)
  }

  // Why the OR: dispatch_id = this dispatch is the fast path for the common case; a question
  // thread opened by an earlier, already-settled dispatch of the same task still counts once if
  // its timestamp falls in the window (dedupe is by message_id via the outbox dedupe key).
  const asks = db.db
    .prepare(
      `SELECT qt.message_id, qt.created_at FROM question_threads qt
       LEFT JOIN dispatch_contexts dc ON dc.id = qt.dispatch_id
       WHERE qt.dispatch_id = ? OR (dc.task_id = ? AND qt.created_at BETWEEN ? AND ?)`
    )
    .all(ids.dispatchId, ids.taskId, start, end) as AskRow[]
  for (const ask of asks) {
    enqueued += enqueueOne(db, ids, 'ask', ask.message_id, ask.created_at)
  }

  const strategy = db.db
    .prepare(`SELECT escalation_offered_at FROM alicorn_task_strategy WHERE task_id = ?`)
    .get(ids.taskId) as EscalationRow | undefined
  const offeredAt = strategy?.escalation_offered_at
  if (offeredAt && offeredAt >= start && offeredAt <= end) {
    enqueued += enqueueOne(db, ids, 'escalation', ids.taskId, offeredAt)
  }

  return enqueued
}

function logCaptureErrorThrottled(dispatchId: string, error: unknown): void {
  const now = Date.now()
  if (now - lastErrorLogAt < ERROR_LOG_THROTTLE_MS) {
    return
  }
  lastErrorLogAt = now
  console.warn(
    '[alicorn] interruption capture skipped',
    dispatchId,
    error instanceof Error ? error.message : String(error)
  )
}

/**
 * Records the gates, questions and escalation offer since the task's last settled dispatch (see
 * LC-R9 above) as ledger interruptions, through the outbox (exactly-once via dedupe key). Returns
 * the number of newly enqueued rows; a re-run over the same dispatch enqueues none.
 *
 * Never throws: this runs on the settlement path and a capture failure must not fail the report.
 */
export function enqueueInterruptionsForDispatch(
  db: OrchestrationDb,
  ids: DispatchInterruptionIds
): number {
  try {
    return enqueueInterruptions(db, ids)
  } catch (error) {
    logCaptureErrorThrottled(ids.dispatchId, error)
    return 0
  }
}
