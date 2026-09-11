import { describe, expect, it } from 'vitest'
import type { RunInspectorDispatch } from './run-inspector-view'
import type { ProvenanceCheckView } from './provenance-view'
import { EMPTY_SESSION_PROGRESS, summarizeSessionProgress } from './session-progress'

function check(status: ProvenanceCheckView['status']): ProvenanceCheckView {
  return {
    dispatchId: 'd',
    kind: 'diff_coverage',
    name: 'Diff coverage',
    required: true,
    status,
    ratio: null
  }
}

function dispatch(overrides: Partial<RunInspectorDispatch> = {}): RunInspectorDispatch {
  return {
    dispatchId: 'd1',
    taskId: 't1',
    stageKey: 'build',
    member: 'Dev',
    backend: 'claude',
    outcome: 'succeeded',
    gate: {
      decision: 'unknown',
      reason: 'unknown',
      gateId: null,
      agreement: { recorded: false }
    },
    spendCents: 100,
    filesModified: 3,
    reportSummary: '',
    prompt: { kind: 'none' },
    capturedAt: null,
    checks: [],
    createdAt: '2026-09-11T00:00:00.000Z',
    ...overrides
  }
}

describe('summarizeSessionProgress', () => {
  it('reports nothing for a session with no settled dispatch', () => {
    expect(summarizeSessionProgress([])).toEqual(EMPTY_SESSION_PROGRESS)
  })

  // Ledger order is oldest first, so the trailing stage is the one the session reached.
  it('marks the newest stage current and the earlier ones done', () => {
    const progress = summarizeSessionProgress([
      dispatch({ stageKey: 'spec' }),
      dispatch({ stageKey: 'build' }),
      dispatch({ stageKey: 'review' })
    ])
    expect(progress.stages).toEqual([
      { stageKey: 'spec', state: 'done', failed: false },
      { stageKey: 'build', state: 'done', failed: false },
      { stageKey: 'review', state: 'current', failed: false }
    ])
    expect(progress.currentStageKey).toBe('review')
  })

  it('collapses repeated dispatches in a stage into one step', () => {
    const progress = summarizeSessionProgress([
      dispatch({ stageKey: 'build' }),
      dispatch({ stageKey: 'build' })
    ])
    expect(progress.stages).toHaveLength(1)
  })

  // A stage that failed and was retried still says it failed — the record is the point.
  it('keeps a stage marked failed even after a later dispatch succeeds in it', () => {
    const progress = summarizeSessionProgress([
      dispatch({ stageKey: 'build', outcome: 'failed' }),
      dispatch({ stageKey: 'build', outcome: 'succeeded' })
    ])
    expect(progress.stages[0]!.failed).toBe(true)
  })

  it('lists each member once, in the order they first appear', () => {
    const progress = summarizeSessionProgress([
      dispatch({ member: 'Dev', backend: 'claude' }),
      dispatch({ member: 'QA', backend: 'codex' }),
      dispatch({ member: 'Dev', backend: 'claude' })
    ])
    expect(progress.members).toEqual([
      { member: 'Dev', backend: 'claude' },
      { member: 'QA', backend: 'codex' }
    ])
  })

  // The reviewer rule is about the backend, so one name on two backends is two entries.
  it('treats the same name on two backends as two members', () => {
    const progress = summarizeSessionProgress([
      dispatch({ member: 'Dev', backend: 'claude' }),
      dispatch({ member: 'Dev', backend: 'codex' })
    ])
    expect(progress.members).toHaveLength(2)
  })

  it('skips a dispatch that never had a member assigned', () => {
    const progress = summarizeSessionProgress([dispatch({ member: null })])
    expect(progress.members).toEqual([])
  })

  it('counts passed and failed checks across the run, ignoring the rest', () => {
    const progress = summarizeSessionProgress([
      dispatch({ checks: [check('passed'), check('failed')] }),
      dispatch({ checks: [check('passed'), check('skipped'), check('error')] })
    ])
    expect(progress.checksPassed).toBe(2)
    expect(progress.checksFailed).toBe(1)
  })
})
