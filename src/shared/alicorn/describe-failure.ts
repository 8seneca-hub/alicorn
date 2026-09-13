/**
 * A failure, as a line a person can read.
 *
 * `String(value)` on anything that is not a string or an Error gives `[object Object]`, and that is
 * exactly what reached the task screen in red the first time a session failed to open: the IPC
 * layer answers `{ ok: false, error }`, a rejected promise can carry that object, and the
 * `instanceof Error` check misses it.
 *
 * Prefers the fields that actually carry the message, then falls back to JSON rather than to the
 * word "object" — a shape nobody expected is still worth seeing.
 */
export function describeFailure(cause: unknown): string {
  if (typeof cause === 'string') {
    return cause
  }
  if (cause instanceof Error) {
    return cause.message
  }
  if (cause && typeof cause === 'object') {
    const record = cause as Record<string, unknown>
    for (const key of ['error', 'message', 'reason', 'detail']) {
      const value = record[key]
      if (typeof value === 'string' && value.length > 0) {
        return value
      }
    }
    try {
      return JSON.stringify(cause)
    } catch {
      return 'Unreadable failure'
    }
  }
  return String(cause ?? 'Unknown failure')
}
