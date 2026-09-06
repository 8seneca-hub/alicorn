import type { OrchestrationDb } from '../orchestration-db'

// Why: ledger_outbox is a transport queue the drainer alone reads back (never a data store),
// so the corrections sweep can't read a step's reported files from there. The drainer already
// builds them into StepOutcomeInput when it posts a step_outcome; alicorn_dispatch_ledger
// (dispatch-id-keyed, never overwritten) is the durable home for them instead.
export function applySchemaMigrationV35(this: OrchestrationDb, current: number): void {
  if (current < 35) {
    if (!this.hasColumn('alicorn_dispatch_ledger', 'files_modified')) {
      this.db.exec('ALTER TABLE alicorn_dispatch_ledger ADD COLUMN files_modified TEXT')
    }
  }
}
