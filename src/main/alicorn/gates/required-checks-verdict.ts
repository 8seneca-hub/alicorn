import type { RequiredCheck } from '../../../shared/alicorn/members'
import { requiredCheckName } from '../../../shared/alicorn/required-check-name'
import type { DispatchVerificationRow } from '../../runtime/orchestration/db/alicorn/alicorn-rows'

/**
 * Did every check the project *requires* actually pass for this task?
 *
 * The authored list is the question and the recorded results are the answer, so a check that was
 * never run reads as unknown (`null`) rather than as absent — the difference between "nothing was
 * required" and "nobody looked" is the whole point of the gate.
 *
 * A member cannot loosen its own criteria: `authored` comes from the project's admin-authored
 * required checks, never from what the member happened to report.
 *
 * Rows are matched on kind *and* name, because a project may author several checks of one kind —
 * IV1 authors one per repo. A recorded row whose name matches nothing authored is a superseded
 * parameterisation (a re-thresholded coverage check, a check moved to another repo) and reads as
 * "not run", never as this question's answer.
 */
export function resolveRequiredChecksPassed(
  authored: RequiredCheck[],
  recorded: DispatchVerificationRow[]
): boolean | null {
  if (authored.length === 0) {
    return true
  }

  let anyUnknown = false
  for (const check of authored) {
    // Latest wins: listTaskVerifications is ordered by recorded_at, and a re-run's verdict
    // supersedes the run it re-ran.
    const name = requiredCheckName(check)
    const results = recorded.filter(
      (row) => row.required && row.kind === check.kind && row.name === name
    )
    const latest = results.at(-1)
    if (!latest) {
      anyUnknown = true
      continue
    }
    if (latest.status === 'failed' || latest.status === 'error') {
      return false
    }
    // 'skipped' is a real outcome (remote worktree, no git) and it is not a pass.
    if (latest.status === 'skipped') {
      anyUnknown = true
    }
  }
  return anyUnknown ? null : true
}
