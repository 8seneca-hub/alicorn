import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'
import { applySchemaMigrationV40 } from './migrate-v40-gate-agreement'

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  return (sqlite.pragma(`table_info(${table})`) as { name: string }[]).some(
    (r) => r.name === column
  )
}

describe('v40 migration: gate agreement', () => {
  let db: OrchestrationDb | undefined
  let tempDir: string | undefined

  afterEach(() => {
    db?.close()
    db = undefined
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('carries recommended_level and the new outbox kind on a fresh database', () => {
    db = new OrchestrationDb(':memory:')
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(40)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasColumn(sqlite, 'decision_gates', 'recommended_level')).toBe(true)
    expect(
      db.enqueueLedgerOutbox({
        kind: 'gate_agreement_patch',
        dedupeKey: 'gate_agreement:g1',
        payload: {}
      }).duplicate
    ).toBe(false)
  })

  it('rebuilds ledger_outbox without resurrecting a dead row or losing why it died', () => {
    db = new OrchestrationDb(':memory:')
    const pending = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'a', payload: {} })
    const dead = db.enqueueLedgerOutbox({ kind: 'step_outcome', dedupeKey: 'b', payload: {} })
    db.markLedgerOutboxDead(dead.id, '404 not_found')

    // Forced rather than driven by user_version: the rebuild's fidelity is the thing under test,
    // and a v38-shaped fixture would run every earlier migration too.
    applySchemaMigrationV40.call(db, 38)

    expect(db.listDueLedgerOutbox().map((row) => row.id)).toEqual([pending.id])
    const deadRows = db.listDeadLedgerOutbox()
    expect(deadRows).toHaveLength(1)
    expect(deadRows[0]).toMatchObject({ id: dead.id, dead_reason: '404 not_found' })
  })

  it('migrates a database that predates it, keeping the rows it already had', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-gate-agreement-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')

    // Built from the pre-v40 SQL literal: a fresh OrchestrationDb already bakes both in, so this
    // is the only way to exercise a database that genuinely predates them.
    const oldDb = new Database(dbPath)
    oldDb.exec(`
      CREATE TABLE ledger_outbox (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL CHECK (kind IN (
          'step_outcome', 'context_capture', 'spend_attribution', 'step_verification',
          'human_verdict_patch', 'interruption'
        )),
        dedupe_key   TEXT NOT NULL UNIQUE,
        payload      TEXT NOT NULL,
        attempts     INTEGER NOT NULL DEFAULT 0,
        not_before   TEXT,
        last_error   TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        sent_at      TEXT,
        dead_at      TEXT,
        dead_reason  TEXT
      );
      CREATE INDEX idx_ledger_outbox_due ON ledger_outbox(sent_at, not_before);
    `)
    oldDb
      .prepare(`INSERT INTO ledger_outbox (id, kind, dedupe_key, payload) VALUES (?, ?, ?, ?)`)
      .run('lob_1', 'step_outcome', 'step_outcome:d1', '{"foo":"bar"}')
    oldDb.pragma('user_version = 38')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasColumn(sqlite, 'decision_gates', 'recommended_level')).toBe(true)
    expect(db.listDueLedgerOutbox().map((row) => row.id)).toEqual(['lob_1'])
    expect(
      db.enqueueLedgerOutbox({
        kind: 'gate_agreement_patch',
        dedupeKey: 'gate_agreement:g2',
        payload: {}
      }).duplicate
    ).toBe(false)
  })
})
