/**
 * Context window sizes, so a ceiling can be expressed as a fraction of the window rather than a
 * number that goes stale every time a model ships.
 */

/** Every current Claude model unless its 1M variant was chosen explicitly. */
export const CLAUDE_DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000

export const CLAUDE_LONG_CONTEXT_WINDOW_TOKENS = 1_000_000

// Why this spelling: the CLI lists its long-context variants as `opus[1m]` and `sonnet[1m]`,
// distinct entries from the plain ones, so the marker — not the family — is what says 1M.
const LONG_CONTEXT_MARKER = /[[_-]1m\b|\[1m\]/i

// The CLI's short selectors alongside the API's full ids; both reach this function.
const CLAUDE_MODEL = /^(?:anthropic[/:])?(?:claude|opus|sonnet|haiku|fable)\b/i

/**
 * Returns the window in tokens, or null when the model is not one we know the window for.
 *
 * Null rather than a default: a ceiling derived from the wrong window is worse than no ceiling —
 * too low it compacts a lead that had room to think, too high it never fires at all. A recognised
 * Claude model with no 1M marker is not a guess, though: 200k is the documented default.
 */
export function claudeContextWindowTokens(model: string | null | undefined): number | null {
  const trimmed = model?.trim()
  if (!trimmed) {
    return null
  }
  if (LONG_CONTEXT_MARKER.test(trimmed)) {
    return CLAUDE_LONG_CONTEXT_WINDOW_TOKENS
  }
  return CLAUDE_MODEL.test(trimmed) ? CLAUDE_DEFAULT_CONTEXT_WINDOW_TOKENS : null
}
