import type { OrchestrationDb } from '../orchestration-db'
import { createAlicornTablesSql } from './create-alicorn-tables-sql'

export function applySchemaMigrationV31(this: OrchestrationDb, current: number): void {
  if (current < 31) {
    this.db.exec(createAlicornTablesSql())
  }
}
