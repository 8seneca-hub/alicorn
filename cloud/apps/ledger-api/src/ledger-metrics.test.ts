import { describe, expect, it, vi } from 'vitest'
import {
  _resetAmendedWithinWindowCacheForTests,
  escapeLabel,
  LedgerMetrics,
  refreshAmendedWithinWindow
} from './ledger-metrics.js'

describe('LedgerMetrics', () => {
  it('renders a gate decision label pair as its own counter series', () => {
    const metrics = new LedgerMetrics()
    metrics.incGateDecision('auto', 'accept-rate')
    expect(metrics.renderPrometheus()).toContain('gate_decisions_total{decision="auto",reason="accept-rate"} 1')
  })
})

describe('escapeLabel', () => {
  it('escapes backslash, double-quote, and newline for a Prometheus label value', () => {
    expect(escapeLabel('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd')
  })
})

describe('refreshAmendedWithinWindow', () => {
  // Why a query-counting fake, not a real pool: item 6 is about cadence and failure handling,
  // which a real Postgres round trip cannot assert as cheaply or deterministically.
  function fakePool(queryImpl: () => Promise<{ rows: { count: string }[] }>) {
    let calls = 0
    const client = {
      query: async (sql: string) => (sql.includes('count(*)') ? ((calls += 1), await queryImpl()) : { rows: [] }),
      release: () => {}
    }
    return { pool: { connect: async () => client } as never, callCount: () => calls }
  }

  it('keeps the last known value and logs once when the query throws', async () => {
    _resetAmendedWithinWindowCacheForTests()
    const metrics = new LedgerMetrics()
    metrics.setAmendedWithinWindow(3)
    const { pool } = fakePool(async () => {
      throw new Error('pool down')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Well past the 30s cache window measured from the reset state (timestamp 0).
    await refreshAmendedWithinWindow(metrics, pool, 'local', () => 40_000)

    expect(metrics.renderPrometheus()).toContain('amended_within_window 3')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not re-query within the 30s cache window, and refreshes once it lapses', async () => {
    _resetAmendedWithinWindowCacheForTests()
    const metrics = new LedgerMetrics()
    const { pool, callCount } = fakePool(async () => ({ rows: [{ count: '5' }] }))

    await refreshAmendedWithinWindow(metrics, pool, 'local', () => 40_000)
    expect(callCount()).toBe(1)
    expect(metrics.renderPrometheus()).toContain('amended_within_window 5')

    await refreshAmendedWithinWindow(metrics, pool, 'local', () => 40_000 + 29_000)
    expect(callCount()).toBe(1)

    await refreshAmendedWithinWindow(metrics, pool, 'local', () => 40_000 + 30_000)
    expect(callCount()).toBe(2)
  })
})
