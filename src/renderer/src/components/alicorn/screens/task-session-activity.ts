/**
 * What a task's surfaces are allowed to claim about its session.
 *
 * The header used to draw a green running dot on every member chip whether or not anything was
 * running, which is the one thing a status dot must never do. This is the single reading both the
 * chip and the session's own status line take, so they cannot disagree.
 */
export type TaskSessionActivity = 'offline' | 'idle' | 'working' | 'waiting'
