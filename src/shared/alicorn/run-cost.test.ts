import { describe, expect, it } from 'vitest'
import { formatRunCostUsd } from './run-cost'

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
