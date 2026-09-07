import type { CommitSummary } from './git-history-reader'

export type SettledStep = {
  outcomeId: string
  taskId: string
  dispatchId: string
  completedAt: number
  filesModified: string[]
}

export type DispatchSpan = {
  taskId: string
  dispatchedAt: number
  completedAt: number | null
}

export type Correction = {
  outcomeId: string
  verdict: 'amended' | 'rejected'
  amendedAfterMs: number
  source: 'follow_up_commit' | 'revert'
  sha: string
}

export const CORRECTION_WINDOW_MS = 72 * 3_600_000

const REVERT_BODY_RE = /^This reverts commit ([0-9a-f]{7,40})/m

function touchesReportedFiles(paths: string[], filesModified: string[]): boolean {
  const modified = new Set(filesModified)
  return paths.some((path) => modified.has(path))
}

function coversAllReportedFiles(paths: string[], filesModified: string[]): boolean {
  const touched = new Set(paths)
  return filesModified.every((path) => touched.has(path))
}

/** Agents only act inside dispatches, so a covering span makes the commit agent work, not a human correction. */
function isCoveredByDispatch(spans: DispatchSpan[], taskId: string, atTime: number): boolean {
  return spans.some(
    (span) =>
      span.taskId === taskId &&
      span.dispatchedAt <= atTime &&
      (span.completedAt === null || atTime <= span.completedAt)
  )
}

function classifyQualifyingCommit(commit: CommitSummary, step: SettledStep): Correction {
  // decision 2: a revert only rejects the step when it covers every file the step touched.
  const isRevert =
    REVERT_BODY_RE.test(commit.body) && coversAllReportedFiles(commit.paths, step.filesModified)
  return {
    outcomeId: step.outcomeId,
    verdict: isRevert ? 'rejected' : 'amended',
    amendedAfterMs: commit.authorTime - step.completedAt,
    source: isRevert ? 'revert' : 'follow_up_commit',
    sha: commit.sha
  }
}

/** decision 1 & 2 (identity-free correction rule): one correction per step, from its earliest qualifying commit. */
export function classifyCorrections(
  steps: SettledStep[],
  commits: CommitSummary[],
  spans: DispatchSpan[],
  now: number
): Correction[] {
  const corrections: Correction[] = []
  for (const step of steps) {
    const windowEnd = step.completedAt + CORRECTION_WINDOW_MS
    let earliest: CommitSummary | null = null
    for (const commit of commits) {
      if (commit.authorTime <= step.completedAt) {
        continue
      }
      // authorTime beyond `now` would be a commit from the future -- never a valid candidate.
      if (commit.authorTime > windowEnd || commit.authorTime > now) {
        continue
      }
      if (!touchesReportedFiles(commit.paths, step.filesModified)) {
        continue
      }
      if (isCoveredByDispatch(spans, step.taskId, commit.authorTime)) {
        continue
      }
      if (!earliest || commit.authorTime < earliest.authorTime) {
        earliest = commit
      }
    }
    if (earliest) {
      corrections.push(classifyQualifyingCommit(earliest, step))
    }
  }
  return corrections
}
