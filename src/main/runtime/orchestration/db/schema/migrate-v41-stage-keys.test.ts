import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

const NEW_COLUMNS = ['stage_key', 'retired_at', 'retirement_refusal'] as const

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  return (sqlite.pragma(`table_info(${table})`) as { name: string }[]).some(
    (r) => r.name === column
  )
}

describe('v41 migration: stable stage keys and gate retirement', () => {
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

  it('carries the retirement columns on a fresh database', () => {
    db = new OrchestrationDb(':memory:')
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(41)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    for (const column of NEW_COLUMNS) {
      expect(hasColumn(sqlite, 'decision_gates', column)).toBe(true)
    }
  })

  it('migrates a database that predates it and leaves its gates unretired', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-stage-keys-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')

    const oldDb = new Database(dbPath)
    oldDb.exec(`
      CREATE TABLE decision_gates (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL DEFAULT 'legacy',
        task_id       TEXT NOT NULL,
        question      TEXT NOT NULL,
        options       TEXT NOT NULL DEFAULT '[]',
        status        TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'resolved', 'timeout')),
        resolution    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at   TEXT,
        recommended_decision TEXT CHECK(recommended_decision IN ('gate', 'auto')),
        recommended_reason   TEXT,
        recommended_level    INTEGER
      );
    `)
    oldDb
      .prepare('INSERT INTO decision_gates (id, run_id, task_id, question) VALUES (?, ?, ?, ?)')
      .run('gate_old', 'run_1', 'task_1', 'ship it?')
    oldDb.pragma('user_version = 40')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db
    expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    for (const column of NEW_COLUMNS) {
      expect(hasColumn(sqlite, 'decision_gates', column)).toBe(true)
    }
    // Nothing is backfilled: a gate opened before SK1 has no canonical stage key, and inventing
    // one would put made-up rows into the window that decides whether a gate may retire.
    expect(db.getGate('gate_old')).toMatchObject({
      id: 'gate_old',
      stage_key: null,
      retired_at: null,
      retirement_refusal: null
    })
  })
})
