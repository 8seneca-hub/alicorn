import { describe, expect, it } from 'vitest'
import { escapeLabel, LedgerMetrics } from './ledger-metrics.js'

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
