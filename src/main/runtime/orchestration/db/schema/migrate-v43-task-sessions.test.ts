import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

function hasTable(sqlite: Database.Database, table: string): boolean {
  return !!sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)
}

const SESSION = { sessionId: 'claude_1', agent: 'claude', worktreeId: 'w1' }

describe('v43 migration: alicorn_task_sessions', () => {
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

  it('adds the table for a database migrating up from v42, losing none of its rows', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'alicorn-task-sessions-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')

    // The fresh-create path bakes the table in, so dropping it is the only way to exercise the
    // upgrade an existing install actually takes.
    db = new OrchestrationDb(dbPath)
    db.setTaskExecutionStrategy('task-1', 'orchestrated', 'user')
    db.close()
    db = undefined

    const oldDb = new Database(dbPath)
    oldDb.exec('DROP TABLE IF EXISTS alicorn_task_sessions')
    oldDb.pragma('user_version = 42')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(43)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(hasTable(sqlite, 'alicorn_task_sessions')).toBe(true)
    expect(db.getTaskExecutionStrategy('task-1').strategy).toBe('orchestrated')

    // A task nobody started has no session, which is what every task in an upgraded install is.
    expect(db.getTaskSession('task-1')).toBeNull()
  })

  it('keeps one session per task: starting again replaces it rather than adding a second', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'alicorn-task-sessions-replace-'))
    db = new OrchestrationDb(join(tempDir, 'orchestration.db'))

    expect(db.setTaskSession('task-1', SESSION)).toEqual(SESSION)
    expect(db.getTaskSession('task-1')).toEqual(SESSION)

    const restarted = { sessionId: 'claude_2', agent: 'claude', worktreeId: 'w2' }
    db.setTaskSession('task-1', restarted)
    expect(db.getTaskSession('task-1')).toEqual(restarted)
  })
})
