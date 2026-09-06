import { describe, expect, it } from 'vitest'
import type { CommitSummary } from './git-history-reader'
import {
  CORRECTION_WINDOW_MS,
  classifyCorrections,
  type DispatchSpan,
  type SettledStep
} from './corrections-watcher'

const COMPLETED_AT = 1_700_000_000_000
const HOUR_MS = 3_600_000

function step(overrides: Partial<SettledStep> = {}): SettledStep {
  return {
    outcomeId: 'o1',
    taskId: 't1',
    dispatchId: 'd1',
    completedAt: COMPLETED_AT,
    filesModified: ['src/a.ts'],
    ...overrides
  }
}

function commit(overrides: Partial<CommitSummary> = {}): CommitSummary {
  return {
    sha: 'c1',
    authorTime: COMPLETED_AT + HOUR_MS,
    subject: 'follow-up',
    body: '',
    paths: ['src/a.ts'],
    ...overrides
  }
}

const NOW = COMPLETED_AT + CORRECTION_WINDOW_MS + HOUR_MS

describe('classifyCorrections', () => {
  it('classifies a commit inside the window touching a reported file, with no covering dispatch, as amended', () => {
    const result = classifyCorrections([step()], [commit()], [], NOW)

    expect(result).toEqual([
      {
        outcomeId: 'o1',
        verdict: 'amended',
        amendedAfterMs: HOUR_MS,
        source: 'follow_up_commit',
        sha: 'c1'
      }
    ])
  })

  it('finds no correction when the commit lands during a later dispatch of the same task', () => {
    const spans: DispatchSpan[] = [
      {
        taskId: 't1',
        dispatchedAt: COMPLETED_AT + HOUR_MS - 1000,
        completedAt: COMPLETED_AT + 2 * HOUR_MS
      }
    ]

    expect(classifyCorrections([step()], [commit()], spans, NOW)).toEqual([])
  })

  it('finds no correction when the covering dispatch is still running (completedAt null)', () => {
    const spans: DispatchSpan[] = [
      { taskId: 't1', dispatchedAt: COMPLETED_AT + HOUR_MS - 1000, completedAt: null }
    ]

    expect(classifyCorrections([step()], [commit()], spans, NOW)).toEqual([])
  })

  it('finds no correction when the commit lands outside the 72h window', () => {
    const lateCommit = commit({ authorTime: COMPLETED_AT + CORRECTION_WINDOW_MS + HOUR_MS })

    expect(classifyCorrections([step()], [lateCommit], [], NOW)).toEqual([])
  })

  it('classifies a revert covering all of the step files as rejected', () => {
    const revertCommit = commit({
      sha: 'r1',
      subject: 'Revert "add feature"',
      body: 'This reverts commit 0123abcdef0123abcdef0123abcdef0123abcde.',
      paths: ['src/a.ts', 'src/b.ts']
    })
    const twoFileStep = step({ filesModified: ['src/a.ts', 'src/b.ts'] })

    const result = classifyCorrections([twoFileStep], [revertCommit], [], NOW)

    expect(result).toEqual([
      {
        outcomeId: 'o1',
        verdict: 'rejected',
        amendedAfterMs: HOUR_MS,
        source: 'revert',
        sha: 'r1'
      }
    ])
  })

  it('classifies a partial revert (does not cover all step files) as amended', () => {
    const partialRevertCommit = commit({
      sha: 'r2',
      subject: 'Revert "add feature"',
      body: 'This reverts commit 0123abcdef0123abcdef0123abcdef0123abcde.',
      paths: ['src/a.ts']
    })
    const twoFileStep = step({ filesModified: ['src/a.ts', 'src/b.ts'] })

    const result = classifyCorrections([twoFileStep], [partialRevertCommit], [], NOW)

    expect(result).toEqual([
      {
        outcomeId: 'o1',
        verdict: 'amended',
        amendedAfterMs: HOUR_MS,
        source: 'follow_up_commit',
        sha: 'r2'
      }
    ])
  })

  it('keeps only the earliest of two qualifying commits', () => {
    const earlier = commit({ sha: 'earlier', authorTime: COMPLETED_AT + HOUR_MS })
    const later = commit({ sha: 'later', authorTime: COMPLETED_AT + 2 * HOUR_MS })

    const result = classifyCorrections([step()], [later, earlier], [], NOW)

    expect(result).toEqual([
      {
        outcomeId: 'o1',
        verdict: 'amended',
        amendedAfterMs: HOUR_MS,
        source: 'follow_up_commit',
        sha: 'earlier'
      }
    ])
  })
})
