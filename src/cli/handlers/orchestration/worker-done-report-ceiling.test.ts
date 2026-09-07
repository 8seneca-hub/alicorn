import { describe, expect, it, vi } from 'vitest'
import { RuntimeClientError } from '../../runtime-client'
import {
  applyWorkerDoneReportCeiling,
  isOrchestratedWorker,
  spillPathFor
} from './worker-done-report-ceiling'
import { FOREMAN_REPORT_MAX_CHARS } from '../../../shared/alicorn/foreman-report'

function report(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: 'done',
    summary: 'Did the work.',
    changes: [],
    interface_delta: [],
    verification: { command: 'pnpm test', result: 'passed', evidence: 'ok' },
    open_questions: [],
    cost: { tokens_in: 1, tokens_out: 2 },
    ...overrides
  })
}

function flags(entries: Record<string, string | boolean> = {}) {
  return new Map<string, string | boolean>(Object.entries(entries))
}

function run(body: string | undefined, options: Record<string, unknown> = {}) {
  return applyWorkerDoneReportCeiling({
    body,
    flags: flags({ orchestrated: true }),
    cwd: '/repo',
    runId: 'run_1',
    dispatchId: 'dispatch_1',
    reportPath: undefined,
    env: {},
    writeSpill: () => '/repo/.foreman/run_1/dispatch_1-report.md',
    ...options
  })
}

describe('isOrchestratedWorker', () => {
  it('reads the flag the preamble injects', () => {
    expect(isOrchestratedWorker(flags({ orchestrated: true }), {})).toBe(true)
  })

  it('reads the environment stamped at dispatch', () => {
    expect(isOrchestratedWorker(flags(), { ORCA_ALICORN_STRATEGY: 'orchestrated' })).toBe(true)
  })

  it('is false for a single-agent run', () => {
    expect(isOrchestratedWorker(flags(), {})).toBe(false)
    expect(isOrchestratedWorker(flags(), { ORCA_ALICORN_STRATEGY: 'single' })).toBe(false)
  })
})

describe('applyWorkerDoneReportCeiling', () => {
  // `single` is the default and stays the default: the schema is a cost only orchestrated runs pay.
  it('passes free text through untouched on a single-agent run', () => {
    const result = applyWorkerDoneReportCeiling({
      body: 'just some prose',
      flags: flags(),
      cwd: '/repo',
      runId: 'run_1',
      dispatchId: 'dispatch_1',
      reportPath: undefined,
      env: {}
    })
    expect(result).toEqual({ body: 'just some prose', spilled: false })
  })

  // Why: a worker_done with no body must send `undefined`, not an empty string — the runtime would
  // otherwise see a body where there was none.
  it('preserves an absent body on a single-agent run', () => {
    const result = applyWorkerDoneReportCeiling({
      body: undefined,
      flags: flags(),
      cwd: '/repo',
      runId: 'run_1',
      dispatchId: 'dispatch_1',
      reportPath: undefined,
      env: {}
    })
    expect(result).toEqual({ body: undefined, spilled: false })
  })

  it('accepts a valid report on an orchestrated run', () => {
    expect(run(report())).toEqual({ body: report(), spilled: false })
  })

  it('rejects free text on an orchestrated run', () => {
    expect(() => run('not json')).toThrow(RuntimeClientError)
    expect(() => run('not json')).toThrow('Foreman report schema')
  })

  it('rejects a report that misses the schema, naming the field', () => {
    let caught: unknown
    try {
      run(report({ status: 'in_progress' }))
    } catch (error) {
      caught = error
    }
    expect((caught as RuntimeClientError).code).toBe('invalid_report')
    expect((caught as Error).message).toContain('status')
  })

  it('rejects a four-sentence summary through the same path', () => {
    expect(() => run(report({ summary: 'One. Two. Three. Four.' }))).toThrow('three sentences')
  })

  it('rejects a missing body rather than reporting nothing', () => {
    expect(() => run(undefined)).toThrow(RuntimeClientError)
  })

  it('spills an oversized report to the run-scoped path', () => {
    const writeSpill = vi.fn(() => '/repo/.foreman/run_1/dispatch_1-report.md')
    const big = report({
      open_questions: Array.from({ length: 20 }, () => 'q'.repeat(300)),
      changes: Array.from({ length: 200 }, (_, i) => ({
        path: `src/f${i}.ts`,
        kind: 'modified',
        why: 'x'.repeat(200)
      }))
    })
    expect(big.length).toBeGreaterThan(FOREMAN_REPORT_MAX_CHARS)

    const result = run(big, { writeSpill })

    expect(result.spilled).toBe(true)
    expect(writeSpill).toHaveBeenCalledWith('/repo/.foreman/run_1/dispatch_1-report.md', big)
    expect((JSON.parse(result.body ?? '{}') as { artifacts: string[] }).artifacts).toEqual([
      '/repo/.foreman/run_1/dispatch_1-report.md'
    ])
  })

  // Why refuse: --report-path already names where the detail lives, and spilling would write a
  // second file the report does not point at.
  it('refuses to spill when --report-path is already set', () => {
    const big = report({
      changes: Array.from({ length: 200 }, (_, i) => ({
        path: `src/f${i}.ts`,
        kind: 'modified',
        why: 'x'.repeat(200)
      }))
    })
    let caught: unknown
    try {
      run(big, { reportPath: '/somewhere/else.md' })
    } catch (error) {
      caught = error
    }
    expect((caught as RuntimeClientError).code).toBe('report_ambiguous')
  })

  it('does not object to --report-path on a report that fits', () => {
    expect(run(report(), { reportPath: '/somewhere/else.md' }).spilled).toBe(false)
  })
})

describe('spillPathFor', () => {
  it('scopes the spill to the run and dispatch so two workers cannot collide', () => {
    expect(spillPathFor('/repo', 'run_1', 'dispatch_1')).toContain('.foreman')
    expect(spillPathFor('/repo', 'run_1', 'dispatch_1')).not.toBe(
      spillPathFor('/repo', 'run_1', 'dispatch_2')
    )
  })
})
