import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type { LedgerOutboxKind, LedgerOutboxRow } from './alicorn-rows'

export function enqueueLedgerOutbox(
  this: OrchestrationDb,
  item: {
    kind: LedgerOutboxKind
    dedupeKey: string
    payload: unknown
    notBefore?: string
  }
): { id: string; duplicate: boolean } {
  const id = generateId('lob')
  const result = this.db
    .prepare(
      `INSERT OR IGNORE INTO ledger_outbox (id, kind, dedupe_key, payload, not_before)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, item.kind, item.dedupeKey, JSON.stringify(item.payload), item.notBefore ?? null)
  if (result.changes === 0) {
    const existing = this.db
      .prepare('SELECT id FROM ledger_outbox WHERE dedupe_key = ?')
      .get(item.dedupeKey) as { id: string }
    return { id: existing.id, duplicate: true }
  }
  return { id, duplicate: false }
}

export function listDueLedgerOutbox(
  this: OrchestrationDb,
  limit = 25,
  nowIso: string = new Date().toISOString(),
  filter?: { kinds?: LedgerOutboxKind[]; excludeKinds?: LedgerOutboxKind[] }
): LedgerOutboxRow[] {
  const conditions = [
    'sent_at IS NULL',
    'dead_at IS NULL',
    '(not_before IS NULL OR not_before <= ?)'
  ]
  const params: (string | number)[] = [nowIso]
  if (filter?.kinds?.length) {
    conditions.push(`kind IN (${filter.kinds.map(() => '?').join(',')})`)
    params.push(...filter.kinds)
  }
  if (filter?.excludeKinds?.length) {
    conditions.push(`kind NOT IN (${filter.excludeKinds.map(() => '?').join(',')})`)
    params.push(...filter.excludeKinds)
  }
  params.push(limit)
  return this.db
    .prepare(
      `SELECT * FROM ledger_outbox
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at
       LIMIT ?`
    )
    .all(...params) as LedgerOutboxRow[]
}

export function markLedgerOutboxSent(this: OrchestrationDb, id: string): void {
  this.db.prepare("UPDATE ledger_outbox SET sent_at = datetime('now') WHERE id = ?").run(id)
}

export function markLedgerOutboxFailed(
  this: OrchestrationDb,
  id: string,
  error: string,
  retryAt: string
): void {
  this.db
    .prepare(
      `UPDATE ledger_outbox
       SET attempts = attempts + 1, not_before = ?, last_error = ?
       WHERE id = ?`
    )
    .run(retryAt, error, id)
}

// Why: a dead row is a permanent 4xx rejection, not a delivery failure -- attempts still
// increments so the dead count and the drainer's attempt history stay consistent.
export function markLedgerOutboxDead(this: OrchestrationDb, id: string, reason: string): void {
  this.db
    .prepare(
      `UPDATE ledger_outbox
       SET dead_at = datetime('now'), dead_reason = ?, attempts = attempts + 1
       WHERE id = ? AND sent_at IS NULL`
    )
    .run(reason, id)
}

export function listDeadLedgerOutbox(this: OrchestrationDb, limit = 50): LedgerOutboxRow[] {
  return this.db
    .prepare(
      `SELECT * FROM ledger_outbox
       WHERE dead_at IS NOT NULL
       ORDER BY dead_at DESC
       LIMIT ?`
    )
    .all(limit) as LedgerOutboxRow[]
}

export function countDeadLedgerOutbox(this: OrchestrationDb): number {
  const row = this.db
    .prepare('SELECT COUNT(*) AS count FROM ledger_outbox WHERE dead_at IS NOT NULL')
    .get() as { count: number }
  return row.count
}

// Why: rows are never deleted, so requeue clears the dead flag and resets retry state in place.
export function requeueLedgerOutbox(this: OrchestrationDb, id: string): boolean {
  const result = this.db
    .prepare(
      `UPDATE ledger_outbox
       SET dead_at = NULL, dead_reason = NULL, attempts = 0, not_before = NULL, last_error = NULL
       WHERE id = ? AND dead_at IS NOT NULL`
    )
    .run(id)
  return result.changes === 1
}

export type LedgerOutboxMethods = {
  enqueueLedgerOutbox: typeof enqueueLedgerOutbox
  listDueLedgerOutbox: typeof listDueLedgerOutbox
  markLedgerOutboxSent: typeof markLedgerOutboxSent
  markLedgerOutboxFailed: typeof markLedgerOutboxFailed
  markLedgerOutboxDead: typeof markLedgerOutboxDead
  listDeadLedgerOutbox: typeof listDeadLedgerOutbox
  countDeadLedgerOutbox: typeof countDeadLedgerOutbox
  requeueLedgerOutbox: typeof requeueLedgerOutbox
}

export function attachLedgerOutboxMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    enqueueLedgerOutbox,
    listDueLedgerOutbox,
    markLedgerOutboxSent,
    markLedgerOutboxFailed,
    markLedgerOutboxDead,
    listDeadLedgerOutbox,
    countDeadLedgerOutbox,
    requeueLedgerOutbox
  })
}
