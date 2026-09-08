import type { DecisionGateRow, DispatchContextRow, GateStatus } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import { LEGACY_RUN_ID } from '../contract-constants'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'

// ── Decision Gates ──

export function createGate(
  this: OrchestrationDb,
  gate: {
    taskId: string
    question: string
    options?: string[]
    requester?: { handle: string; paneKey?: string | null; dispatchId: string }
  }
): DecisionGateRow {
  this.db.exec('SAVEPOINT create_gate')
  try {
    const active = this.db
      .prepare(
        `SELECT * FROM dispatch_contexts
         WHERE task_id = ? AND status IN ('pending', 'dispatched')
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(gate.taskId) as DispatchContextRow | undefined
    if (
      gate.requester &&
      (!active ||
        active.id !== gate.requester.dispatchId ||
        !this.isDispatchMessageSender({
          dispatchId: active.id,
          handle: gate.requester.handle,
          paneKey: gate.requester.paneKey,
          allowCanonicalDispatchHandle: true
        }))
    ) {
      throw new OrchestrationError(
        'consumer_fenced',
        `Terminal ${gate.requester.handle} does not own the active Dispatch for Task ${gate.taskId}.`,
        { taskId: gate.taskId, dispatchId: active?.id }
      )
    }
    const activeWorker = this.db
      .prepare(
        `SELECT active.id
         FROM dispatch_contexts active
         JOIN worker_dispatches worker ON worker.dispatch_id = active.id
         WHERE active.task_id = ? AND active.status IN ('pending', 'dispatched')
           AND worker.state NOT IN ('failed', 'succeeded', 'stopped', 'abandoned')
         ORDER BY active.rowid DESC LIMIT 1`
      )
      .get(gate.taskId) as { id: string } | undefined
    if (activeWorker) {
      throw new OrchestrationError(
        'task_not_startable',
        `Task ${gate.taskId} cannot open a gate while supervised Dispatch ${activeWorker.id} is active; stop or settle its worker first.`,
        { taskId: gate.taskId, dispatchId: activeWorker.id }
      )
    }
    const id = generateId('gate')
    const optionsJson = JSON.stringify(gate.options ?? [])
    this.db
      .prepare(
        'INSERT INTO decision_gates (id, run_id, task_id, question, options) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        id,
        this.getTask(gate.taskId)?.run_id ?? LEGACY_RUN_ID,
        gate.taskId,
        gate.question,
        optionsJson
      )
    this.completeActiveDispatchesForTask(gate.taskId)
    this.db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(gate.taskId)
    const created = this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(id) as
      | DecisionGateRow
      | undefined
    this.db.exec('RELEASE create_gate')
    return created as DecisionGateRow
  } catch (error) {
    this.db.exec('ROLLBACK TO create_gate')
    this.db.exec('RELEASE create_gate')
    throw error
  }
}

export function resolveGate(
  this: OrchestrationDb,
  gateId: string,
  resolution: string
): DecisionGateRow | undefined {
  const gate = this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(gateId) as
    | DecisionGateRow
    | undefined
  if (!gate) {
    return undefined
  }

  this.db.exec('SAVEPOINT resolve_gate')
  try {
    this.db
      .prepare(
        "UPDATE decision_gates SET status = 'resolved', resolution = ?, resolved_at = datetime('now') WHERE id = ?"
      )
      .run(resolution, gateId)
    this.updateTaskStatus(gate.task_id, 'ready')
    const resolved = this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(gateId) as
      | DecisionGateRow
      | undefined
    this.db.exec('RELEASE resolve_gate')
    return resolved
  } catch (error) {
    this.db.exec('ROLLBACK TO resolve_gate')
    this.db.exec('RELEASE resolve_gate')
    throw error
  }
}

/**
 * Records what the autonomy policy would have decided, under which stage key, and why retirement
 * was refused if it was. Separate from `resolveGate` on purpose: a recommendation never resolves
 * anything, so nothing here touches the gate's status or the task's — that is what "level 0 always
 * gates" means in code. Retiring is `retireGate`, which is a resolution and reads as one.
 */
export function setGateRecommendation(
  this: OrchestrationDb,
  gateId: string,
  recommendation: {
    decision: 'gate' | 'auto'
    reason: string
    level: number | null
    /** SK1's canonical key (`resolveStageKey`), not the caller's free text. */
    stageKey?: string | null
    /** `RetirementRefusal`, or null when the gate is about to be retired. */
    retirementRefusal?: string | null
  }
): DecisionGateRow | undefined {
  this.db
    .prepare(
      `UPDATE decision_gates
       SET recommended_decision = ?, recommended_reason = ?, recommended_level = ?,
           stage_key = ?, retirement_refusal = ?
       WHERE id = ?`
    )
    .run(
      recommendation.decision,
      recommendation.reason,
      recommendation.level,
      recommendation.stageKey ?? null,
      recommendation.retirementRefusal ?? null,
      gateId
    )
  return this.getGate(gateId)
}

/**
 * Level 3 (SK1): the policy resolves the gate itself instead of blocking a human.
 *
 * Deliberately not `resolveGate`, even though the row transition is nearly the same. A resolution
 * has a resolver and counts as an interruption; a retirement has neither, and `retired_at` is what
 * every reader downstream — the interruption sweep, the audit view — keys on to tell them apart.
 * The gate row is still written, because "notifies instead of blocking" needs something to notify
 * about and the record is the product.
 */
export function retireGate(
  this: OrchestrationDb,
  gateId: string,
  resolution: string
): DecisionGateRow | undefined {
  const gate = this.getGate(gateId)
  if (!gate) {
    return undefined
  }
  this.db.exec('SAVEPOINT retire_gate')
  try {
    const { changes } = this.db
      .prepare(
        `UPDATE decision_gates
         SET status = 'resolved', resolution = ?, resolved_at = datetime('now'),
             retired_at = datetime('now'), retirement_refusal = NULL
         WHERE id = ? AND status = 'pending'`
      )
      .run(resolution, gateId)
    // createGate blocked the task; a retired gate must not leave it blocked on nobody. Only when
    // this call is the one that resolved it: a gate already timed out or answered by a human has
    // had its task moved on by whoever did that, and unblocking again would race them.
    if (changes > 0) {
      this.updateTaskStatus(gate.task_id, 'ready')
    }
    const retired = this.getGate(gateId)
    this.db.exec('RELEASE retire_gate')
    return retired
  } catch (error) {
    this.db.exec('ROLLBACK TO retire_gate')
    this.db.exec('RELEASE retire_gate')
    throw error
  }
}

export function timeoutGate(this: OrchestrationDb, gateId: string): DecisionGateRow | undefined {
  this.db
    .prepare(
      // Why: without the status guard a late timeout overwrites a gate the user already resolved.
      "UPDATE decision_gates SET status = 'timeout', resolved_at = datetime('now') WHERE id = ? AND status = 'pending'"
    )
    .run(gateId)
  return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(gateId) as
    | DecisionGateRow
    | undefined
}

export function listGates(
  this: OrchestrationDb,
  filter?: { taskId?: string; status?: GateStatus }
): DecisionGateRow[] {
  if (filter?.taskId && filter?.status) {
    return this.db
      .prepare('SELECT * FROM decision_gates WHERE task_id = ? AND status = ? ORDER BY created_at')
      .all(filter.taskId, filter.status) as DecisionGateRow[]
  }
  if (filter?.taskId) {
    return this.db
      .prepare('SELECT * FROM decision_gates WHERE task_id = ? ORDER BY created_at')
      .all(filter.taskId) as DecisionGateRow[]
  }
  if (filter?.status) {
    return this.db
      .prepare('SELECT * FROM decision_gates WHERE status = ? ORDER BY created_at')
      .all(filter.status) as DecisionGateRow[]
  }
  return this.db
    .prepare('SELECT * FROM decision_gates ORDER BY created_at')
    .all() as DecisionGateRow[]
}

export function getGate(this: OrchestrationDb, id: string): DecisionGateRow | undefined {
  return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(id) as
    | DecisionGateRow
    | undefined
}

export type DecisionGateStoreMethods = {
  createGate: typeof createGate
  resolveGate: typeof resolveGate
  retireGate: typeof retireGate
  setGateRecommendation: typeof setGateRecommendation
  timeoutGate: typeof timeoutGate
  listGates: typeof listGates
  getGate: typeof getGate
}

export function attachDecisionGateStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createGate,
    resolveGate,
    retireGate,
    setGateRecommendation,
    timeoutGate,
    listGates,
    getGate
  })
}
