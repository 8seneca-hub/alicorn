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
  nowIso: string = new Date().toISOString()
): LedgerOutboxRow[] {
  return this.db
    .prepare(
      `SELECT * FROM ledger_outbox
       WHERE sent_at IS NULL AND (not_before IS NULL OR not_before <= ?)
       ORDER BY created_at
       LIMIT ?`
    )
    .all(nowIso, limit) as LedgerOutboxRow[]
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

export type LedgerOutboxMethods = {
  enqueueLedgerOutbox: typeof enqueueLedgerOutbox
  listDueLedgerOutbox: typeof listDueLedgerOutbox
  markLedgerOutboxSent: typeof markLedgerOutboxSent
  markLedgerOutboxFailed: typeof markLedgerOutboxFailed
}

export function attachLedgerOutboxMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    enqueueLedgerOutbox,
    listDueLedgerOutbox,
    markLedgerOutboxSent,
    markLedgerOutboxFailed
  })
}
