import { describe, expect, it } from 'vitest'
import { evaluateLeadContextCeiling, LEAD_CONTEXT_CEILING_FRACTION } from './lead-context-ceiling'
import { buildLeadCompactionPrompt } from './lead-compaction-prompt'

const WINDOW = 200_000
const CEILING = WINDOW * LEAD_CONTEXT_CEILING_FRACTION

describe('evaluateLeadContextCeiling', () => {
  it('is 40% of the window', () => {
    expect(LEAD_CONTEXT_CEILING_FRACTION).toBe(0.4)
    expect(
      evaluateLeadContextCeiling({ contextTokens: 1, model: 'claude-opus-5' })?.ceilingTokens
    ).toBe(80_000)
  })

  it('reads 39% of the window as below the ceiling', () => {
    const verdict = evaluateLeadContextCeiling({
      contextTokens: Math.round(WINDOW * 0.39),
      model: 'claude-opus-5'
    })

    expect(verdict).toMatchObject({ atCeiling: false, windowTokens: WINDOW })
  })

  it('reads 41% of the window as at the ceiling', () => {
    expect(
      evaluateLeadContextCeiling({
        contextTokens: Math.round(WINDOW * 0.41),
        model: 'claude-opus-5'
      })?.atCeiling
    ).toBe(true)
  })

  it('treats the ceiling itself as reached', () => {
    expect(
      evaluateLeadContextCeiling({ contextTokens: CEILING, model: 'claude-opus-5' })?.atCeiling
    ).toBe(true)
  })

  // The same token count is fine on a 1M window and past the ceiling on a 200k one.
  it('scales with the window rather than a fixed number', () => {
    const tokens = 300_000
    expect(
      evaluateLeadContextCeiling({ contextTokens: tokens, model: 'claude-opus-5' })?.atCeiling
    ).toBe(true)
    expect(evaluateLeadContextCeiling({ contextTokens: tokens, model: 'opus[1m]' })).toMatchObject({
      atCeiling: false,
      ceilingTokens: 400_000
    })
  })

  // Why null rather than a verdict: prompting a compaction we cannot justify costs the run a turn
  // and teaches the lead to ignore the prompt.
  it('gives no verdict when the context is unknown', () => {
    expect(evaluateLeadContextCeiling({ contextTokens: null, model: 'claude-opus-5' })).toBeNull()
  })

  it('gives no verdict when the window is unknown', () => {
    expect(evaluateLeadContextCeiling({ contextTokens: 999_999, model: 'gpt-5' })).toBeNull()
    expect(evaluateLeadContextCeiling({ contextTokens: 999_999, model: null })).toBeNull()
  })
})

describe('buildLeadCompactionPrompt', () => {
  const prompt = buildLeadCompactionPrompt({
    contextTokens: 84_000,
    windowTokens: WINDOW,
    ceilingTokens: CEILING,
    atCeiling: true
  })

  it('says where the lead stands', () => {
    expect(prompt).toContain('84k')
    expect(prompt).toContain('40%')
    expect(prompt).toContain('200k')
  })

  // The journal is the source of truth and the context is a cache of it, so the prompt has to name
  // everything that must survive the compaction.
  it('names what to flush before compacting', () => {
    expect(prompt).toContain('.foreman/')
    expect(prompt).toContain('decision')
    expect(prompt).toContain('assumption')
    expect(prompt).toContain('plan table')
    expect(prompt).toContain('contract registry')
    expect(prompt).toContain('/compact')
  })

  // Why restated here: a compaction prompt is a fresh instruction arriving mid-run, and it must not
  // read as licence to start working directly.
  it('restates the restriction that makes it a lead', () => {
    expect(prompt).toContain('write no code')
    expect(prompt).toContain('read no implementation')
  })

  it('does not ask the lead to stop and check in', () => {
    expect(prompt.toLowerCase()).not.toContain('let me know')
    expect(prompt.toLowerCase()).not.toContain('confirm')
  })
})
