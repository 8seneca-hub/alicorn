import { describe, expect, it } from 'vitest'
import { formatRunCostSummary, formatRunCostUsd, summarizeRunCost } from './run-cost'

describe('formatRunCostUsd', () => {
  it('renders null as an em dash', () => {
    expect(formatRunCostUsd(null)).toBe('—')
  })

  it('renders a sub-cent cost as <$0.01', () => {
    expect(formatRunCostUsd(0.004)).toBe('<$0.01')
  })

  it('renders a normal cost rounded to two decimals', () => {
    expect(formatRunCostUsd(0.8234)).toBe('$0.82')
  })
})

describe('summarizeRunCost', () => {
  it('sums the dispatches it can price', () => {
    expect(
      summarizeRunCost(
        {
          a: { costUsd: 1.5, status: 'known' },
          b: { costUsd: 2.25, status: 'known' }
        },
        ['a', 'b']
      )
    ).toEqual({ costUsd: 3.75, partial: false })
  })

  // A node the lead has planned but not dispatched has not run, so it owes nothing and does not
  // make the total a floor.
  it('ignores nodes with no dispatch', () => {
    expect(
      summarizeRunCost({ a: { costUsd: 1, status: 'known' } }, ['a', null, undefined])
    ).toEqual({ costUsd: 1, partial: false })
  })

  it.each(['unavailable', 'pending'] as const)('is partial when a dispatch is %s', (status) => {
    expect(
      summarizeRunCost({ a: { costUsd: 1, status: 'known' }, b: { costUsd: null, status } }, [
        'a',
        'b'
      ])
    ).toEqual({ costUsd: 1, partial: true })
  })

  // Silence is not zero: a dispatch the store has never mentioned is one we cannot price.
  it('is partial when a dispatch is absent from the store', () => {
    expect(summarizeRunCost({ a: { costUsd: 1, status: 'known' } }, ['a', 'b'])).toEqual({
      costUsd: 1,
      partial: true
    })
  })

  it('has no figure when nothing is priced', () => {
    expect(summarizeRunCost({ a: { costUsd: null, status: 'pending' } }, ['a'])).toEqual({
      costUsd: null,
      partial: true
    })
    expect(summarizeRunCost({}, [])).toEqual({ costUsd: null, partial: false })
  })
})

describe('formatRunCostSummary', () => {
  it('shows a plain total when every dispatch is priced', () => {
    expect(formatRunCostSummary({ costUsd: 3.75, partial: false })).toBe('$3.75')
  })

  // The floor must never read as the total — that is the whole reason the marker exists.
  it('marks a floor as a floor', () => {
    expect(formatRunCostSummary({ costUsd: 3.75, partial: true })).toBe('≥ $3.75 (partial)')
  })

  it('shows a dash rather than a guess when nothing is priced', () => {
    expect(formatRunCostSummary({ costUsd: null, partial: true })).toBe('—')
    expect(formatRunCostSummary({ costUsd: null, partial: false })).toBe('—')
  })
})
