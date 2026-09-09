import { resolveOrchestrationMigrationStartVersion } from '../../orchestration-schema-version-skew'
import { SCHEMA_VERSION } from '../contract-constants'
import type { OrchestrationDb } from '../orchestration-db'
import { applySchemaMigrationsV13ToV30 } from './migrate-v13-v30'
import { applySchemaMigrationsV2ToV12 } from './migrate-v2-v12'
import { applySchemaMigrationV31 } from './migrate-v31-alicorn'
import { applySchemaMigrationV32 } from './migrate-v32-run-cost-index'
import { applySchemaMigrationV33 } from './migrate-v33-alicorn'
import { applySchemaMigrationV34 } from './migrate-v34-board'
import { applySchemaMigrationV35 } from './migrate-v35-dispatch-ledger-files'
import { applySchemaMigrationV36 } from './migrate-v36-board-transition-dispatch'
import { applySchemaMigrationV37 } from './migrate-v37-outbox-dead-letter'
import { applySchemaMigrationV38 } from './migrate-v38-gate-policy'
import { applySchemaMigrationV39 } from './migrate-v39-task-worktrees'
import { applySchemaMigrationV40 } from './migrate-v40-gate-agreement'
import { applySchemaMigrationV41 } from './migrate-v41-stage-keys'
import { applySchemaMigrationV42 } from './migrate-v42-verification-dedupe-key'

// Why: CREATE TABLE IF NOT EXISTS won't alter existing DBs; migrate in a txn that bumps user_version only on success (atomic all-or-nothing).
export function migrate(this: OrchestrationDb): void {
  const storedVersion = this.db.pragma('user_version', { simple: true }) as number
  const current = resolveOrchestrationMigrationStartVersion(this.db, storedVersion, SCHEMA_VERSION)
  if (current >= SCHEMA_VERSION) {
    return
  }

  this.db.exec('BEGIN IMMEDIATE')
  try {
    applySchemaMigrationsV2ToV12.call(this, current)
    applySchemaMigrationsV13ToV30.call(this, current)
    applySchemaMigrationV31.call(this, current)
    applySchemaMigrationV32.call(this, current)
    applySchemaMigrationV33.call(this, current)
    applySchemaMigrationV34.call(this, current)
    applySchemaMigrationV35.call(this, current)
    applySchemaMigrationV36.call(this, current)
    applySchemaMigrationV37.call(this, current)
    applySchemaMigrationV38.call(this, current)
    applySchemaMigrationV39.call(this, current)
    applySchemaMigrationV40.call(this, current)
    applySchemaMigrationV41.call(this, current)
    applySchemaMigrationV42.call(this, current)
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
    this.db.exec('COMMIT')
  } catch (err) {
    this.db.exec('ROLLBACK')
    throw err
  }
}

export type SchemaMigrateMethods = {
  migrate: typeof migrate
}

export function attachSchemaMigrate(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    migrate
  })
}
