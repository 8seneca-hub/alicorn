/**
 * Whether the New project dialog is open, for the one caller outside the shell that needs to open
 * it: onboarding.
 *
 * A module store rather than app state, for the same reason the assistant has one — this is one
 * dialog's presentation, and putting it in global state invites something to start treating "is a
 * project being created" as a fact about the app.
 *
 * Why onboarding needs it at all: its last step used to open *Orca's* Add-a-project dialog, which
 * is a repository picker wearing Alicorn's word for something else. A first run should end on the
 * thing Alicorn calls a project — name, task key, what it is for, and the repositories it binds —
 * and that dialog can add a folder itself, so nothing is lost by going straight to it.
 */
let open = false
const listeners = new Set<() => void>()

export function getAlicornNewProjectOpen(): boolean {
  return open
}

export function subscribeAlicornNewProject(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setAlicornNewProjectOpen(next: boolean): void {
  if (open === next) {
    return
  }
  open = next
  for (const listener of listeners) {
    listener()
  }
}
