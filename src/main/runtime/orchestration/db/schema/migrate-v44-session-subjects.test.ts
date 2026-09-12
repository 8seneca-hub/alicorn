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

describe('v44 migration: alicorn_sessions', () => {
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

  it("carries a v43 database's task sessions across the rename, losing no row", () => {
    tempDir = mkdtempSync(join(tmpdir(), 'alicorn-session-subjects-'))
    const dbPath = join(tempDir, 'orchestration.db')

    // Synthesize a genuine v43 database: the table under its old name, holding a row.
    db = new OrchestrationDb(dbPath)
    db.close()
    db = undefined
    const oldDb = new Database(dbPath)
    oldDb.exec('DROP TABLE IF EXISTS alicorn_sessions')
    oldDb.exec(`
      CREATE TABLE alicorn_task_sessions (
        task_id     TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        agent       TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    oldDb
      .prepare(
        'INSERT INTO alicorn_task_sessions (task_id, session_id, agent, worktree_id) VALUES (?, ?, ?, ?)'
      )
      .run('tsk_1', SESSION.sessionId, SESSION.agent, SESSION.worktreeId)
    oldDb.pragma('user_version = 43')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(44)
    expect(hasTable(sqlite, 'alicorn_sessions')).toBe(true)
    expect(hasTable(sqlite, 'alicorn_task_sessions')).toBe(false)
    // The task's session survives the rename under the name it was always keyed by.
    expect(db.getSubjectSession('tsk_1')).toEqual(SESSION)
  })

  it('keeps one session per subject, and a project chat never collides with a task', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'alicorn-session-subjects-replace-'))
    db = new OrchestrationDb(join(tempDir, 'orchestration.db'))

    expect(db.setSubjectSession('tsk_1', SESSION)).toEqual(SESSION)
    expect(db.getSubjectSession('tsk_1')).toEqual(SESSION)

    const projectChat = { sessionId: 'claude_2', agent: 'claude', worktreeId: 'w2' }
    db.setSubjectSession('project:prj_1', projectChat)
    expect(db.getSubjectSession('project:prj_1')).toEqual(projectChat)
    expect(db.getSubjectSession('tsk_1')).toEqual(SESSION)

    const restarted = { sessionId: 'claude_3', agent: 'claude', worktreeId: 'w3' }
    db.setSubjectSession('tsk_1', restarted)
    expect(db.getSubjectSession('tsk_1')).toEqual(restarted)
  })
})
