import type { OrchestrationDb } from '../orchestration-db'
import { createAlicornTablesSql } from './create-alicorn-tables-sql'
import { createAlicornBoardTablesSql } from './create-alicorn-board-tables-sql'
import { createCoreTablesSql } from './create-core-tables-sql'
import { createGraphTablesSql } from './create-graph-tables-sql'

export function createTables(this: OrchestrationDb): void {
  this.db.exec(
    `${createCoreTablesSql()}\n${createGraphTablesSql()}\n${createAlicornTablesSql()}\n${createAlicornBoardTablesSql()}`
  )
  this.createMailboxDeliveryIndexesIfPossible()
}

export type CreateTablesMethods = {
  createTables: typeof createTables
}

export function attachCreateTables(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createTables
  })
}
