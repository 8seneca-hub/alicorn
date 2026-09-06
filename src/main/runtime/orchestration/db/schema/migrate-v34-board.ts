import type { OrchestrationDb } from '../orchestration-db'
import { createAlicornBoardTablesSql } from './create-alicorn-board-tables-sql'

export function applySchemaMigrationV34(this: OrchestrationDb, current: number): void {
  if (current < 34) {
    this.db.exec(createAlicornBoardTablesSql())
  }
}
