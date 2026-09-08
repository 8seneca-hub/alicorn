import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

function hasTable(sqlite: Database.Database, table: string): boolean {
  return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
}

describe('v39 migration: alicorn_task_worktrees', () => {
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

  it('adds the table for a database migrating up from v38, losing none of its rows', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-task-worktrees-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')

    // Build at the current schema, then synthesize a genuine pre-v39 database: the fresh-create
    // path bakes the table in, so dropping it is the only way to exercise the upgrade.
    db = new OrchestrationDb(dbPath)
    db.setTaskExecutionStrategy('task-1', 'orchestrated', 'user')
    db.close()
    db = undefined

    const oldDb = new Database(dbPath)
    oldDb.exec('DROP TABLE IF EXISTS alicorn_task_worktrees')
    oldDb.pragma('user_version = 38')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    // >= rather than ===: this asserts the database migrated past v39, not that v39 is newest.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(39)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasTable(sqlite, 'alicorn_task_worktrees')).toBe(true)

    // Pre-migration state survives, and a task with no tuples still reads as single-repo — an
    // upgraded install has no multi-repo tasks and nothing to backfill.
    expect(db.getTaskExecutionStrategy('task-1').strategy).toBe('orchestrated')
    expect(db.listTaskWorktrees('task-1')).toEqual([])

    db.setTaskWorktrees('task-1', [{ repoId: 'repo_api', worktreeId: 'w1', branch: 'main' }])
    expect(db.listTaskWorktrees('task-1')).toEqual([
      { repoId: 'repo_api', worktreeId: 'w1', branch: 'main', primary: true }
    ])
  })

  it('exists on a freshly created database, not only on the migration path', () => {
    db = new OrchestrationDb(':memory:')
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasTable(sqlite, 'alicorn_task_worktrees')).toBe(true)
  })
})
