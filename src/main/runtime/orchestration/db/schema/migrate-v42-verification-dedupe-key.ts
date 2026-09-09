import type { OrchestrationDb } from '../orchestration-db'

/**
 * ALC-113: the verification row's dedupe key said `diff_coverage` when the row covers *every*
 * authored required check for the dispatch — since CR2, and now three kinds deep (`diff_coverage`,
 * `integration_verify`, `skill`). Behaviour was correct; the name was a lie that reads as a bug
 * every time someone greps for why a `skill` check is queued under coverage.
 *
 * Why a migration and not a rename: `dedupe_key` is UNIQUE and is the only thing stopping a second
 * enqueue for a dispatch already queued. Changing the format in code alone would leave an in-flight
 * row keyed the old way, and the next enqueue for that dispatch would not match it — one dispatch,
 * two verification rows, which is exactly the double-count the outbox exists to prevent.
 *
 * Unsent rows only. A sent row is history and its key is what the drainer actually used; rewriting
 * it would make the audit trail describe a request that was never made.
 */
export function applySchemaMigrationV42(this: OrchestrationDb, current: number): void {
  if (current < 42) {
    // OR IGNORE: if a new-format row for the same dispatch somehow already exists (a downgrade and
    // re-upgrade), the old row keeps its key and drains on payload as it always did. Losing the
    // rename is fine; losing the row to a UNIQUE violation would not be.
    this.db.exec(`
      UPDATE OR IGNORE ledger_outbox
         SET dedupe_key = substr(dedupe_key, 1, length(dedupe_key) - length(':diff_coverage'))
       WHERE kind = 'step_verification'
         AND sent_at IS NULL
         AND dedupe_key LIKE 'step_verification:%:diff_coverage'
    `)
  }
}
