import type { RequiredCheck } from './members'

/**
 * The `step_verifications` row name an authored check writes under.
 *
 * One function, because the name is an *identity*: the ledger upserts on (dispatch, kind, name),
 * and the gate matches a recorded row back to the check that asked for it. A project may author
 * several checks of one kind — IV1 is one per repo — so kind alone no longer identifies a row, and
 * two spellings of the name would let one check's verdict answer for another's.
 *
 * A parameter that changes the outcome belongs in the name: a re-thresholded `diff_coverage` is a
 * different question, and its old rows must read as "not run", never as this question's answer.
 */
export function requiredCheckName(check: RequiredCheck): string {
  switch (check.kind) {
    case 'diff_coverage':
      return `Diff coverage ≥ ${Math.round(check.threshold * 100)}%`
    case 'contract_acknowledged':
      return 'Breaking contracts acknowledged'
    case 'integration_verify':
      return `Integration verify (${check.repoId})`
    // The id, not the human-readable skill name: two `skill` checks on one project must not
    // overwrite each other's verdict, and a catalog rename must not orphan the row a gate reads.
    // The readable name goes in `detail`.
    case 'skill':
      return check.versionId ? `${check.skillId}@${check.versionId}` : check.skillId
  }
}
