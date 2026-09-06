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

describe('v35 migration: alicorn_dispatch_ledger.files_modified', () => {
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

  it('adds files_modified for a database migrating up from v34, preserving existing rows', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-dispatch-ledger-files-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    db.setDispatchLedgerOutcome('dispatch-1', 'so_1', [])
    db.close()
    db = undefined

    const oldDb = new Database(dbPath)
    oldDb.exec('ALTER TABLE alicorn_dispatch_ledger DROP COLUMN files_modified')
    oldDb.pragma('user_version = 34')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    // Why >= rather than === 35: asserts the database migrated up past v35, not that v35 is the
    // newest migration -- matches migrate-v33-alicorn.test.ts's robustification for the same reason.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(35)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasColumn(sqlite, 'alicorn_dispatch_ledger', 'files_modified')).toBe(true)

    // Pre-migration row preserved (outcome id still readable).
    expect(db.getDispatchLedgerOutcome('dispatch-1')).toBe('so_1')

    // New column round-trips.
    db.setDispatchLedgerOutcome('dispatch-2', 'so_2', ['a.ts', 'b.ts'])
    expect(db.getDispatchLedgerEntry('dispatch-2')).toEqual({
      outcomeId: 'so_2',
      filesModified: ['a.ts', 'b.ts']
    })
  })

  it('exists on a freshly created database (fresh-schema path, not just migration)', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-dispatch-ledger-files-fresh-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasColumn(sqlite, 'alicorn_dispatch_ledger', 'files_modified')).toBe(true)

    db.setDispatchLedgerOutcome('dispatch-1', 'so_1', ['x.ts'])
    expect(db.getDispatchLedgerEntry('dispatch-1')).toEqual({
      outcomeId: 'so_1',
      filesModified: ['x.ts']
    })
  })
})
