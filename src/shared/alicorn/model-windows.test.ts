import { describe, expect, it } from 'vitest'
import {
  CLAUDE_DEFAULT_CONTEXT_WINDOW_TOKENS,
  CLAUDE_LONG_CONTEXT_WINDOW_TOKENS,
  claudeContextWindowTokens
} from './model-windows'

describe('claudeContextWindowTokens', () => {
  it.each(['opus[1m]', 'sonnet[1m]', 'claude-sonnet-5[1m]', 'claude-opus-5[1m]'])(
    'reads %s as the long window',
    (model) => {
      expect(claudeContextWindowTokens(model)).toBe(CLAUDE_LONG_CONTEXT_WINDOW_TOKENS)
    }
  )

  // Why: the CLI lists `sonnet` and `sonnet[1m]` as distinct choices, so the family alone does not
  // say 1M — only the marker does.
  it.each(['opus', 'sonnet', 'claude-opus-5', 'claude-sonnet-5-20260514', 'claude-haiku-4-5'])(
    'reads %s as the default window',
    (model) => {
      expect(claudeContextWindowTokens(model)).toBe(CLAUDE_DEFAULT_CONTEXT_WINDOW_TOKENS)
    }
  )

  it('accepts the provider-prefixed spelling', () => {
    expect(claudeContextWindowTokens('anthropic/claude-opus-5')).toBe(
      CLAUDE_DEFAULT_CONTEXT_WINDOW_TOKENS
    )
  })

  // Why null and not a default: a ceiling from the wrong window is worse than none.
  it.each(['gpt-5-codex', 'grok-4', 'something-else'])('knows no window for %s', (model) => {
    expect(claudeContextWindowTokens(model)).toBeNull()
  })

  it.each([null, undefined, '', '   '])('knows no window for %p', (model) => {
    expect(claudeContextWindowTokens(model)).toBeNull()
  })

  // A model named after a 1M variant is still a 1M variant however it is spelled.
  it('does not mistake an unrelated 1m substring for the marker', () => {
    expect(claudeContextWindowTokens('claude-opus-1modal')).toBe(
      CLAUDE_DEFAULT_CONTEXT_WINDOW_TOKENS
    )
  })
})
