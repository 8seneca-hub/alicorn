import { afterEach, describe, expect, it } from 'vitest'
import type Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'
import { applySchemaMigrationV42 } from './migrate-v42-verification-dedupe-key'

type SqliteHost = { db: Database.Database }

function sqliteOf(db: OrchestrationDb): Database.Database {
  return (db as unknown as SqliteHost).db
}

function keysOf(db: OrchestrationDb): { dedupe_key: string; sent_at: string | null }[] {
  return sqliteOf(db)
    .prepare('SELECT dedupe_key, sent_at FROM ledger_outbox ORDER BY dedupe_key')
    .all() as { dedupe_key: string; sent_at: string | null }[]
}

describe('v42 migration: the verification dedupe key stops naming one check kind', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  it('enqueues a fresh verification row under the kind-neutral key', () => {
    db = new OrchestrationDb(':memory:')
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(42)
    expect(sqliteOf(db).pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)

    expect(
      db.enqueueLedgerOutbox({
        kind: 'step_verification',
        dedupeKey: 'step_verification:d1',
        payload: {}
      }).duplicate
    ).toBe(false)
  })

  // The reason this is a migration and not a rename: an in-flight row keyed the old way would not
  // match the new key, and the dispatch would queue a second verification row.
  it('renames an unsent row so the next enqueue still dedupes against it', () => {
    db = new OrchestrationDb(':memory:')
    sqliteOf(db)
      .prepare(
        `INSERT INTO ledger_outbox (id, kind, dedupe_key, payload)
         VALUES ('row-1', 'step_verification', 'step_verification:d1:diff_coverage', '{}')`
      )
      .run()

    applySchemaMigrationV42.call(db, 41)

    expect(keysOf(db).map((row) => row.dedupe_key)).toEqual(['step_verification:d1'])
    expect(
      db.enqueueLedgerOutbox({
        kind: 'step_verification',
        dedupeKey: 'step_verification:d1',
        payload: {}
      }).duplicate
    ).toBe(true)
  })

  // A sent row is history: its key is the one the drainer actually used.
  it('leaves the key of a row already sent alone', () => {
    db = new OrchestrationDb(':memory:')
    sqliteOf(db)
      .prepare(
        `INSERT INTO ledger_outbox (id, kind, dedupe_key, payload, sent_at)
         VALUES ('row-1', 'step_verification', 'step_verification:d1:diff_coverage', '{}', '2026-09-09T00:00:00Z')`
      )
      .run()

    applySchemaMigrationV42.call(db, 41)

    expect(keysOf(db).map((row) => row.dedupe_key)).toEqual(['step_verification:d1:diff_coverage'])
  })

  // A downgrade and re-upgrade can leave both spellings queued; the rename must not delete a row.
  it('keeps both rows when the new key is already taken', () => {
    db = new OrchestrationDb(':memory:')
    const insert = sqliteOf(db).prepare(
      `INSERT INTO ledger_outbox (id, kind, dedupe_key, payload) VALUES (?, 'step_verification', ?, '{}')`
    )
    insert.run('row-old', 'step_verification:d1:diff_coverage')
    insert.run('row-new', 'step_verification:d1')

    applySchemaMigrationV42.call(db, 41)

    expect(keysOf(db).map((row) => row.dedupe_key)).toEqual([
      'step_verification:d1',
      'step_verification:d1:diff_coverage'
    ])
  })

  it('does not touch another kind that happens to end the same way', () => {
    db = new OrchestrationDb(':memory:')
    sqliteOf(db)
      .prepare(
        `INSERT INTO ledger_outbox (id, kind, dedupe_key, payload)
         VALUES ('row-1', 'step_outcome', 'step_outcome:d1:diff_coverage', '{}')`
      )
      .run()

    applySchemaMigrationV42.call(db, 41)

    expect(keysOf(db).map((row) => row.dedupe_key)).toEqual(['step_outcome:d1:diff_coverage'])
  })
})
