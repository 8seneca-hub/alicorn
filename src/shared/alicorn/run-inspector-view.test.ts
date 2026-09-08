import { describe, expect, it } from 'vitest'
import { buildProvenanceView } from './provenance-view'
import type { ProvenanceView } from './provenance-view'
import type { ContextCaptureList, ProvenanceReport, RunCost, StepOutcomeRecord } from './ledger'
import {
  PROMPT_PREVIEW_CHARS,
  buildRunInspectorView,
  previewPrompt,
  runsInProvenance,
  selectRunId
} from './run-inspector-view'

function outcome(overrides: Partial<StepOutcomeRecord> = {}): StepOutcomeRecord {
  return {
    id: 'o1',
    tenantId: 'local',
    runId: 'run_1',
    taskId: 't1',
    dispatchId: 'd1',
    backend: 'claude',
    stageKey: 'build',
    executionStrategy: 'single',
    outcome: 'succeeded',
    filesModified: ['a.ts'],
    reviewBackendBypass: false,
    escalationOffered: false,
    escalationAccepted: null,
    spendCents: 61,
    usage: null,
    gateDecision: 'auto',
    gateReason: 'auto',
    createdAt: '2026-09-06T00:00:00.000Z',
    ...overrides
  }
}

function provenance(outcomes: StepOutcomeRecord[], extra: Partial<ProvenanceReport> = {}) {
  const report: ProvenanceReport = {
    repoId: 'r1',
    branch: 'feature/x',
    outcomes,
    verifications: [],
    contextCaptures: [],
    totals: { spendCents: 0, tasks: outcomes.length, dispatches: outcomes.length },
    reviewBackend: { enforced: true, bypassed: false },
    ...extra
  }
  return buildProvenanceView(report, { policyEnforced: true })
}

function captures(rows: Partial<ContextCaptureList['captures'][number]>[]): ContextCaptureList {
  return {
    captures: rows.map((row) => ({
      dispatchId: 'd1',
      createdAt: '2026-09-06T00:00:01.000Z',
      promptBytes: 0,
      prompt: null,
      promptPath: null,
      contextSlice: {},
      ...row
    })),
    truncated: false
  }
}

function cost(byDispatch: RunCost['byDispatch']): RunCost {
  return {
    runId: 'run_1',
    totalSpendCents: byDispatch.reduce((sum, d) => sum + (d.spendCents ?? 0), 0),
    byDispatch
  }
}

function inspect(view: ProvenanceView, input: Parameters<typeof buildRunInspectorView>[1]) {
  return buildRunInspectorView(view, input)
}

describe('buildRunInspectorView', () => {
  it('says a spilled prompt lives in a file rather than showing an empty one', () => {
    const view = inspect(provenance([outcome()]), {
      runId: 'run_1',
      captures: captures([
        { dispatchId: 'd1', promptPath: '/var/alicorn/prompts/d1.md', prompt: null }
      ]),
      cost: null
    })
    expect(view.dispatches[0]?.prompt).toEqual({
      kind: 'file',
      path: '/var/alicorn/prompts/d1.md'
    })
  })

  it('never puts a byte count on a spilled prompt, because the ledger records zero for one', () => {
    // The write side measures the inline prompt only, so a spilled capture stores prompt_bytes 0 —
    // rendering that as its size would state the opposite of what happened.
    const view = inspect(provenance([outcome()]), {
      runId: 'run_1',
      captures: captures([{ dispatchId: 'd1', promptPath: '/tmp/d1.md', promptBytes: 0 }]),
      cost: null
    })
    expect(view.dispatches[0]?.prompt).not.toHaveProperty('bytes')
  })

  it('distinguishes a dispatch that captured nothing from one whose prompt is on disk', () => {
    const view = inspect(
      provenance([outcome({ id: 'a', dispatchId: 'd1' }), outcome({ id: 'b', dispatchId: 'd2' })]),
      {
        runId: 'run_1',
        captures: captures([{ dispatchId: 'd1', prompt: 'hello', promptBytes: 5 }]),
        cost: null
      }
    )
    expect(view.dispatches[0]?.prompt).toEqual({ kind: 'inline', bytes: 5 })
    expect(view.dispatches[1]?.prompt).toEqual({ kind: 'none' })
  })

  it('carries no prompt text at all, whatever the capture held', () => {
    // The whole shape crosses IPC on every poll; a body is fetched for one dispatch on demand.
    const view = inspect(provenance([outcome()]), {
      runId: 'run_1',
      captures: captures([{ dispatchId: 'd1', prompt: 'the exact prompt', promptBytes: 16 }]),
      cost: null
    })
    expect(JSON.stringify(view)).not.toContain('the exact prompt')
  })

  it('treats an unpriced dispatch as a floor, not as a total', () => {
    const view = inspect(provenance([outcome()]), {
      runId: 'run_1',
      captures: null,
      cost: cost([
        { dispatchId: 'd1', taskId: 't1', backend: 'claude', spendCents: 250 },
        { dispatchId: 'd2', taskId: 't1', backend: 'other', spendCents: null }
      ])
    })
    expect(view.cost).toEqual({ costUsd: 2.5, partial: true })
  })

  it('reports no cost rather than zero when the run cost could not be read', () => {
    const view = inspect(provenance([outcome()]), { runId: 'run_1', captures: null, cost: null })
    expect(view.cost).toEqual({ costUsd: null, partial: false })
  })

  it('counts the run dispatches this branch cannot show, so a slice does not read as the run', () => {
    const view = inspect(provenance([outcome({ dispatchId: 'd1' })]), {
      runId: 'run_1',
      captures: null,
      cost: cost([
        { dispatchId: 'd1', taskId: 't1', backend: 'claude', spendCents: 10 },
        { dispatchId: 'd_other_repo', taskId: 't2', backend: 'claude', spendCents: 10 }
      ])
    })
    expect(view.dispatchesOutsideBranch).toBe(1)
  })

  it('keeps the ledger cap visible so a truncated run does not look like a short one', () => {
    const view = inspect(provenance([outcome()]), {
      runId: 'run_1',
      captures: { ...captures([]), truncated: true },
      cost: null
    })
    expect(view.capturesTruncated).toBe(true)
  })

  it('shows only the selected run and attaches each check to the dispatch that earned it', () => {
    const view = inspect(
      provenance(
        [
          outcome({ id: 'a', runId: 'run_1', dispatchId: 'd1' }),
          outcome({ id: 'b', runId: 'run_2', dispatchId: 'd2' })
        ],
        {
          verifications: [
            {
              id: 'v1',
              runId: 'run_1',
              taskId: 't1',
              dispatchId: 'd1',
              kind: 'diff_coverage',
              name: 'diff coverage',
              required: true,
              status: 'passed',
              detail: { ratio: 0.9 },
              createdAt: '2026-09-06T00:00:02.000Z'
            }
          ]
        }
      ),
      { runId: 'run_1', captures: null, cost: null }
    )
    expect(view.dispatches.map((d) => d.dispatchId)).toEqual(['d1'])
    expect(view.dispatches[0]?.checks).toEqual([
      { dispatchId: 'd1', kind: 'diff_coverage', name: 'diff coverage', required: true, status: 'passed', ratio: 0.9 }
    ])
  })
})

describe('runsInProvenance', () => {
  it('offers runs newest first, dated by their earliest step', () => {
    const view = provenance([
      outcome({ id: 'a', runId: 'run_old', createdAt: '2026-09-01T00:00:00.000Z' }),
      outcome({ id: 'b', runId: 'run_new', createdAt: '2026-09-05T00:00:00.000Z' }),
      outcome({
        id: 'c',
        runId: 'run_new',
        dispatchId: 'd2',
        createdAt: '2026-09-04T00:00:00.000Z'
      })
    ])
    expect(runsInProvenance(view)).toEqual([
      { runId: 'run_new', startedAt: '2026-09-04T00:00:00.000Z', dispatchCount: 2 },
      { runId: 'run_old', startedAt: '2026-09-01T00:00:00.000Z', dispatchCount: 1 }
    ])
  })
})

describe('selectRunId', () => {
  it('honours a requested run, falls back to the newest, and is empty with no steps', () => {
    const view = provenance([
      outcome({ id: 'a', runId: 'run_old', createdAt: '2026-09-01T00:00:00.000Z' }),
      outcome({ id: 'b', runId: 'run_new', createdAt: '2026-09-05T00:00:00.000Z' })
    ])
    expect(selectRunId(view, 'run_old')).toBe('run_old')
    expect(selectRunId(view, 'run_from_another_branch')).toBe('run_new')
    expect(selectRunId(view, null)).toBe('run_new')
    expect(selectRunId(provenance([]))).toBe('')
  })
})

describe('previewPrompt', () => {
  it('returns a short prompt whole and says how much of a long one it held back', () => {
    expect(previewPrompt('short')).toEqual({ text: 'short', hiddenChars: 0 })
    const long = 'x'.repeat(PROMPT_PREVIEW_CHARS + 25)
    expect(previewPrompt(long)).toEqual({
      text: 'x'.repeat(PROMPT_PREVIEW_CHARS),
      hiddenChars: 25
    })
  })
})
