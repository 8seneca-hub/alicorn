import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

function hasTable(sqlite: Database.Database, name: string): boolean {
  return (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  )
}

describe('v33 migration: outbox kinds for human verdicts and interruptions', () => {
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

  it('rebuilds ledger_outbox for a database migrating up from v32: preserves rows, widens the CHECK', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-outbox-v33-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    db.close()
    db = undefined

    // Why rebuilt here, not stamped on the current-schema table: the fresh-create path already
    // has the widened CHECK, so pinning user_version alone never exercises the widening (#review).
    const oldDb = new Database(dbPath)
    oldDb.exec(`
      DROP TABLE ledger_outbox;
      CREATE TABLE ledger_outbox (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('step_outcome', 'context_capture', 'spend_attribution', 'step_verification')),
        dedupe_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        not_before TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT
      );
    `)
    oldDb
      .prepare(`INSERT INTO ledger_outbox (id, kind, dedupe_key, payload) VALUES (?, ?, ?, ?)`)
      .run('lob_1', 'step_outcome', 'step_outcome:dispatch-1', '{"foo":"bar"}')
    oldDb.pragma('user_version = 32')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    // Why >= rather than === 33: this asserts the database migrated up past v33, not that v33 is
    // the newest migration. Pinning the global constant here fails for whoever adds the next one.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(33)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)

    const preserved = db.listDueLedgerOutbox()
    expect(preserved).toHaveLength(1)
    expect(preserved[0].dedupe_key).toBe('step_outcome:dispatch-1')

    const { duplicate } = db.enqueueLedgerOutbox({
      kind: 'human_verdict_patch',
      dedupeKey: 'human_verdict_patch:so_1',
      payload: {}
    })
    expect(duplicate).toBe(false)
    expect(db.listDueLedgerOutbox()).toHaveLength(2)
  })

  it('accepts every new kind and has both new tables on a freshly created database', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-outbox-v33-fresh-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)

    expect(() =>
      db!.enqueueLedgerOutbox({
        kind: 'interruption',
        dedupeKey: 'interruption:gate-1',
        payload: {}
      })
    ).not.toThrow()

    expect(hasTable(sqlite, 'alicorn_correction_scans')).toBe(true)
    expect(hasTable(sqlite, 'alicorn_dispatch_ledger')).toBe(true)
  })
})
