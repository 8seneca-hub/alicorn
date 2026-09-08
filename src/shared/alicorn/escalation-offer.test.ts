import { describe, expect, it } from 'vitest'
import { evaluateEscalationSignal } from './escalation-offer'

describe('evaluateEscalationSignal', () => {
  it('raises multi_repo when the task is bound to more than one repo', () => {
    expect(evaluateEscalationSignal({ repoCount: 3, contextTokens: null })).toEqual({
      signal: 'multi_repo',
      contextTokens: null,
      repoCount: 3
    })
  })

  // The negative that matters: ~90% of daily work is one repo and must stay untouched.
  it.each([0, 1])('stays silent for a task on %i repos under the ceiling', (repoCount) => {
    expect(evaluateEscalationSignal({ repoCount, contextTokens: 12_000 })).toBeNull()
  })

  it('raises context_ceiling at the ceiling on a single-repo task', () => {
    expect(evaluateEscalationSignal({ repoCount: 1, contextTokens: 300_000 })).toEqual({
      signal: 'context_ceiling',
      contextTokens: 300_000,
      repoCount: null
    })
  })

  // Why multi_repo wins: it is true from the start and names what is different about the work.
  it('prefers multi_repo when both facts hold', () => {
    expect(evaluateEscalationSignal({ repoCount: 2, contextTokens: 400_000 })?.signal).toBe(
      'multi_repo'
    )
  })

  it('never offers on an unmeasured backend', () => {
    expect(evaluateEscalationSignal({ repoCount: 1, contextTokens: null })).toBeNull()
  })

  it('honours an overridden ceiling', () => {
    expect(
      evaluateEscalationSignal({ repoCount: 1, contextTokens: 900, ceilingTokens: 1_000 })
    ).toBeNull()
  })
})
