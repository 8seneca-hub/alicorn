import { describe, expect, it } from 'vitest'
import { resolveRequiredChecksPassed } from './required-checks-verdict'
import type { RequiredCheck } from '../../../shared/alicorn/members'
import type { DispatchVerificationRow } from '../../runtime/orchestration/db/alicorn/alicorn-rows'

const COVERAGE: RequiredCheck = {
  kind: 'diff_coverage',
  threshold: 0.8,
  lcovPath: 'coverage/lcov.info',
  timeoutMs: 600_000
}

function result(overrides: Partial<DispatchVerificationRow> = {}): DispatchVerificationRow {
  return {
    dispatchId: 'dispatch-1',
    taskId: 'task-1',
    kind: 'diff_coverage',
    name: 'Diff coverage ≥ 80%',
    required: true,
    status: 'passed',
    detail: null,
    recordedAt: '2026-09-08T12:00:00.000Z',
    ...overrides
  }
}

describe('resolveRequiredChecksPassed', () => {
  it('is vacuously true when the project requires nothing', () => {
    expect(resolveRequiredChecksPassed([], [])).toBe(true)
  })

  it('is true when every authored check has a passing result', () => {
    expect(resolveRequiredChecksPassed([COVERAGE], [result()])).toBe(true)
  })

  it('is unknown when an authored check has no result at all', () => {
    expect(resolveRequiredChecksPassed([COVERAGE], [])).toBeNull()
  })

  it('is unknown when the only result was skipped', () => {
    expect(resolveRequiredChecksPassed([COVERAGE], [result({ status: 'skipped' })])).toBeNull()
  })

  it.each(['failed', 'error'] as const)('is false when a check %s', (status) => {
    expect(resolveRequiredChecksPassed([COVERAGE], [result({ status })])).toBe(false)
  })

  it('lets the latest result supersede the run it re-ran', () => {
    expect(
      resolveRequiredChecksPassed(
        [COVERAGE],
        [
          result({ status: 'failed', recordedAt: '2026-09-08T11:00:00.000Z' }),
          result({ status: 'passed', recordedAt: '2026-09-08T12:00:00.000Z' })
        ]
      )
    ).toBe(true)
  })

  it('ignores results the project did not require', () => {
    expect(resolveRequiredChecksPassed([COVERAGE], [result({ required: false })])).toBeNull()
  })

  it('ignores results of a kind nothing authored', () => {
    expect(
      resolveRequiredChecksPassed([COVERAGE], [result({ kind: 'lint', status: 'failed' })])
    ).toBeNull()
  })
})

// CR2: the gate reads the new kind through the same authored-list mechanism, so the only thing
// worth asserting is that a second kind is not silently answered by the first one's result.
describe('contract_acknowledged', () => {
  const CONTRACTS: RequiredCheck = { kind: 'contract_acknowledged' }

  it('gates on an unacknowledged breaking contract', () => {
    const failed = result({
      kind: 'contract_acknowledged',
      name: 'Breaking contracts acknowledged',
      status: 'failed'
    })
    expect(resolveRequiredChecksPassed([CONTRACTS], [failed])).toBe(false)
    expect(resolveRequiredChecksPassed([COVERAGE, CONTRACTS], [result(), failed])).toBe(false)
  })

  it('does not let a passing coverage result answer for the contract check', () => {
    expect(resolveRequiredChecksPassed([COVERAGE, CONTRACTS], [result()])).toBeNull()
  })

  it('passes once the acknowledged verdict is recorded', () => {
    const passed = result({
      kind: 'contract_acknowledged',
      name: 'Breaking contracts acknowledged'
    })
    expect(resolveRequiredChecksPassed([COVERAGE, CONTRACTS], [result(), passed])).toBe(true)
  })
})
