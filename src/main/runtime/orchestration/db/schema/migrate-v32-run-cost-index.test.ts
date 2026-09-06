import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

function hasIndex(sqlite: Database.Database, name: string): boolean {
  return (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) !==
    undefined
  )
}

describe('v32 migration: dispatch_contexts(status, completed_at) index', () => {
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

  it('creates the compound index for a database migrating up from v31', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-run-cost-index-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    db.close()
    db = undefined

    const oldDb = new Database(dbPath)
    oldDb.exec('DROP INDEX IF EXISTS idx_dispatch_status_completed_at')
    oldDb.pragma('user_version = 31')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasIndex(sqlite, 'idx_dispatch_status_completed_at')).toBe(true)
  })

  it('exists on a freshly created database (fresh-schema path, not just migration)', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-run-cost-index-fresh-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasIndex(sqlite, 'idx_dispatch_status_completed_at')).toBe(true)
  })
})
