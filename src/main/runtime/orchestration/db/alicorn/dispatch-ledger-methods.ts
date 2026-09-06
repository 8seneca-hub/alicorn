import type { OrchestrationDb } from '../orchestration-db'

export function setDispatchLedgerOutcome(
  this: OrchestrationDb,
  dispatchId: string,
  outcomeId: string
): void {
  this.db
    .prepare(
      'INSERT OR REPLACE INTO alicorn_dispatch_ledger (dispatch_id, outcome_id) VALUES (?, ?)'
    )
    .run(dispatchId, outcomeId)
}

export function getDispatchLedgerOutcome(this: OrchestrationDb, dispatchId: string): string | null {
  const row = this.db
    .prepare('SELECT outcome_id FROM alicorn_dispatch_ledger WHERE dispatch_id = ?')
    .get(dispatchId) as { outcome_id: string } | undefined
  return row ? row.outcome_id : null
}

export type DispatchLedgerMethods = {
  setDispatchLedgerOutcome: typeof setDispatchLedgerOutcome
  getDispatchLedgerOutcome: typeof getDispatchLedgerOutcome
}

export function attachDispatchLedgerMethods(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    setDispatchLedgerOutcome,
    getDispatchLedgerOutcome
  })
}
