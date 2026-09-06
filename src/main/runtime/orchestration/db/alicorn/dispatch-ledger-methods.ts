import type { OrchestrationDb } from '../orchestration-db'

export function setDispatchLedgerOutcome(
  this: OrchestrationDb,
  dispatchId: string,
  outcomeId: string,
  filesModified: string[]
): void {
  this.db
    .prepare(
      `INSERT OR REPLACE INTO alicorn_dispatch_ledger (dispatch_id, outcome_id, files_modified)
       VALUES (?, ?, ?)`
    )
    .run(dispatchId, outcomeId, JSON.stringify(filesModified))
}

export function getDispatchLedgerOutcome(this: OrchestrationDb, dispatchId: string): string | null {
  const row = this.db
    .prepare('SELECT outcome_id FROM alicorn_dispatch_ledger WHERE dispatch_id = ?')
    .get(dispatchId) as { outcome_id: string } | undefined
  return row ? row.outcome_id : null
}

export type DispatchLedgerEntry = { outcomeId: string; filesModified: string[] }

// Why a sibling method rather than changing getDispatchLedgerOutcome's return shape: its existing
// callers (e.g. the reopened-task path) only need the outcome id.
export function getDispatchLedgerEntry(
  this: OrchestrationDb,
  dispatchId: string
): DispatchLedgerEntry | null {
  const row = this.db
    .prepare('SELECT outcome_id, files_modified FROM alicorn_dispatch_ledger WHERE dispatch_id = ?')
    .get(dispatchId) as { outcome_id: string; files_modified: string | null } | undefined
  if (!row) {
    return null
  }
  return {
    outcomeId: row.outcome_id,
    filesModified: row.files_modified ? (JSON.parse(row.files_modified) as string[]) : []
  }
}

export type DispatchLedgerMethods = {
  setDispatchLedgerOutcome: typeof setDispatchLedgerOutcome
  getDispatchLedgerOutcome: typeof getDispatchLedgerOutcome
  getDispatchLedgerEntry: typeof getDispatchLedgerEntry
}

export function attachDispatchLedgerMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    setDispatchLedgerOutcome,
    getDispatchLedgerOutcome,
    getDispatchLedgerEntry
  })
}
