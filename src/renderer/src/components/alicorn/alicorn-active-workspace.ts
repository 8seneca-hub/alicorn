/**
 * The workspace Alicorn currently has in scope, if any.
 *
 * Alicorn's right sidebar is keyed to the *active worktree*, which survives everything — deleting a
 * project does not unregister a repository, so the file tree happily keeps describing a workspace
 * the product no longer references. On the projects list that reads as a contradiction: "No
 * projects yet" beside a folder listing.
 *
 * Alicorn only has a workspace in scope while a session is mounted, so the session says so and the
 * chrome reads it. A module store rather than the app store: this is presentation scope for one
 * view, it changes on mount and unmount, and putting it in global state would invite something to
 * start treating it as the authority on which worktree is active.
 */
const listeners = new Set<() => void>()
let worktreeId: string | null = null

export function setAlicornActiveWorkspace(next: string | null): void {
  if (worktreeId === next) {
    return
  }
  worktreeId = next
  for (const listener of listeners) {
    listener()
  }
}

export function getAlicornActiveWorkspace(): string | null {
  return worktreeId
}

export function subscribeAlicornActiveWorkspace(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
