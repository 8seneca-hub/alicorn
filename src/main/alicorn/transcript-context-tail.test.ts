import { describe, expect, it } from 'vitest'
import { contextTokensFromTranscriptTail } from './transcript-context-tail'

function turn(usage: Record<string, number>, timestamp = '2026-09-06T10:00:00.000Z'): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 'sess_1',
    timestamp,
    message: { id: 'msg_1', model: 'claude-opus-5', usage }
  })
}

describe('contextTokensFromTranscriptTail', () => {
  // Why: the context window is what the *next* turn must carry — input plus both cache halves.
  // Output tokens are not in it, so counting them would offer escalation too early.
  it('sums input and both cache halves of the last turn', () => {
    const text = [
      turn({ input_tokens: 10, cache_read_input_tokens: 10, cache_creation_input_tokens: 10 }),
      turn({
        input_tokens: 250_000,
        output_tokens: 9_000,
        cache_read_input_tokens: 60_000,
        cache_creation_input_tokens: 1_000
      })
    ].join('\n')

    expect(contextTokensFromTranscriptTail(text)).toBe(311_000)
  })

  // Why: reading a fixed-size tail slices mid-line, and the *first* line is the broken one.
  it('ignores a leading partial line', () => {
    const text = ['{"type":"assis', turn({ input_tokens: 5, cache_read_input_tokens: 1 })].join(
      '\n'
    )
    expect(contextTokensFromTranscriptTail(text)).toBe(6)
  })

  // Why: a transcript is still being written; the final line is often half-flushed.
  it('falls back to the last complete turn when the final line is truncated', () => {
    const text = [
      turn({ input_tokens: 7, cache_read_input_tokens: 3 }),
      '{"type":"assistant","mess'
    ].join('\n')
    expect(contextTokensFromTranscriptTail(text)).toBe(10)
  })

  it('returns null when no line carries usage', () => {
    expect(contextTokensFromTranscriptTail('{"type":"user","message":{"role":"user"}}')).toBeNull()
    expect(contextTokensFromTranscriptTail('')).toBeNull()
  })
})
