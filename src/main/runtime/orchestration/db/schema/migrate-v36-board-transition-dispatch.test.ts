import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

function indexNames(sqlite: Database.Database, table: string): string[] {
  const rows = sqlite.pragma(`index_list(${table})`) as { name: string }[]
  return rows.map((row) => row.name)
}

describe('v36 migration: alicorn_board_transitions dispatch index', () => {
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

  it('adds the dispatch index for a database migrating up from v35, keeping its rows', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-board-transition-index-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    db.recordBoardTransition({
      repoId: 'repo_1',
      worktreeId: 'wt_1',
      dispatchId: 'dispatch-1',
      toStatusId: 'in-review',
      ruleId: 'rule_1',
      outcome: 'dispatched'
    })
    db.close()
    db = undefined

    const oldDb = new Database(dbPath)
    oldDb.exec('DROP INDEX IF EXISTS idx_board_transitions_dispatch')
    oldDb.pragma('user_version = 35')
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = new Database(dbPath)
    try {
      expect(indexNames(sqlite, 'alicorn_board_transitions')).toContain(
        'idx_board_transitions_dispatch'
      )
      expect(sqlite.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    } finally {
      sqlite.close()
    }
    expect(db.getBoardTransitionByDispatch('dispatch-1')?.toStatusId).toBe('in-review')
  })

  it('creates the index on a fresh database without migrating', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-board-transition-index-fresh-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    const sqlite = new Database(dbPath)
    try {
      expect(indexNames(sqlite, 'alicorn_board_transitions')).toContain(
        'idx_board_transitions_dispatch'
      )
    } finally {
      sqlite.close()
    }
  })

  it('resolves only the dispatch it was recorded against', () => {
    db = new OrchestrationDb(':memory:')
    db.recordBoardTransition({
      repoId: 'repo_1',
      worktreeId: 'wt_1',
      dispatchId: 'dispatch-1',
      toStatusId: 'in-review',
      ruleId: 'rule_1',
      outcome: 'dispatched'
    })
    expect(db.getBoardTransitionByDispatch('dispatch-2')).toBeNull()
  })
})
