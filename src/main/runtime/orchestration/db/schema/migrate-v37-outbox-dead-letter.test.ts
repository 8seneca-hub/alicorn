import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  const rows = sqlite.pragma(`table_info(${table})`) as { name: string }[]
  return rows.some((r) => r.name === column)
}

describe('v37 migration: ledger_outbox dead-letter columns', () => {
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

  it('adds dead_at/dead_reason for a database migrating up from v36, preserving existing rows', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-outbox-dead-letter-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')

    // Why built from the pre-v37 SQL literal, not a fresh OrchestrationDb with columns dropped:
    // the fresh-create path already bakes in dead_at/dead_reason, so this is the only way to
    // exercise a database that genuinely predates them.
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
        sent_at      TEXT
      );
      CREATE INDEX idx_ledger_outbox_due ON ledger_outbox(sent_at, not_before);
    `)
    oldDb
      .prepare(`INSERT INTO ledger_outbox (id, kind, dedupe_key, payload) VALUES (?, ?, ?, ?)`)
      .run('lob_1', 'step_outcome', 'step_outcome:dispatch-1', '{"foo":"bar"}')
    oldDb.pragma('user_version = 36')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    // Why >= rather than === 37: asserts the database migrated up past v37, not that v37 is the
    // newest migration -- matches migrate-v35-dispatch-ledger-files.test.ts for the same reason.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(37)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasColumn(sqlite, 'ledger_outbox', 'dead_at')).toBe(true)
    expect(hasColumn(sqlite, 'ledger_outbox', 'dead_reason')).toBe(true)

    // Pre-migration row preserved and still due.
    const due = db.listDueLedgerOutbox()
    expect(due).toHaveLength(1)
    expect(due[0].id).toBe('lob_1')
    expect(due[0].dead_at).toBeNull()
  })

  it('exists on a freshly created database (fresh-schema path, not just migration)', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-outbox-dead-letter-fresh-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasColumn(sqlite, 'ledger_outbox', 'dead_at')).toBe(true)
    expect(hasColumn(sqlite, 'ledger_outbox', 'dead_reason')).toBe(true)

    const { id } = db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-2',
      payload: {}
    })
    db.markLedgerOutboxDead(id, 'permanent rejection: 422')
    expect(db.listDueLedgerOutbox()).toHaveLength(0)
    expect(db.countDeadLedgerOutbox()).toBe(1)
  })
})
