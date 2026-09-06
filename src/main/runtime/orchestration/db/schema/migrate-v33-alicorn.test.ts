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

  it('rebuilds ledger_outbox for a database migrating up from v32: preserves rows, accepts the new kinds, adds the new tables', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-outbox-v33-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    db.enqueueLedgerOutbox({
      kind: 'step_outcome',
      dedupeKey: 'step_outcome:dispatch-1',
      payload: { foo: 'bar' }
    })
    db.close()
    db = undefined

    const oldDb = new Database(dbPath)
    oldDb.pragma('user_version = 32')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(SCHEMA_VERSION).toBe(33)
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

    expect(hasTable(sqlite, 'alicorn_correction_scans')).toBe(true)
    expect(hasTable(sqlite, 'alicorn_dispatch_ledger')).toBe(true)
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
