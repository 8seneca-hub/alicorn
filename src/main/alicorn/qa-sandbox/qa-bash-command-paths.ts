/**
 * Every path-shaped token in a shell command line.
 *
 * This is deliberately a *scan*, not a parse: the rule is that a QA pane may not run a command
 * that names a path it may not read, whatever the command is. Listing reader programs instead
 * (`cat`, `head`, …) would be unsound in the other direction — `find . -exec cat {} +` names no
 * reader at the head, and `sh -c` names none at all.
 *
 * What it does not catch is a path the shell builds at runtime (`$var`, `$(…)`, a Python one-liner
 * that concatenates strings). That hole is real and is stated as such; the sound fix is a
 * workspace that never contains the implementation, not a better regex.
 */
const SEPARATORS = /[\s;|&<>()`'"]+/
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i
const HAS_EXTENSION = /\.[A-Za-z0-9_]+$/

function isPathShaped(token: string): boolean {
  if (!token || token.startsWith('-') || URL_LIKE.test(token)) {
    return false
  }
  if (token === '.' || token === '..') {
    return true
  }
  return token.includes('/') || token.includes('\\') || HAS_EXTENSION.test(token)
}

/** Changing directory reads nothing, and `cd <worktree> && …` is how most agents open a command. */
const DIRECTORY_CHANGE = new Set(['cd', 'pushd'])

export function bashCommandPaths(command: string): string[] {
  const paths = new Set<string>()
  let previous = ''
  for (const raw of command.split(SEPARATORS)) {
    if (!raw) {
      continue
    }
    // A `--flag=path` still names the path; the flag half is dropped, not the value.
    const token = raw.includes('=') && raw.startsWith('-') ? raw.slice(raw.indexOf('=') + 1) : raw
    const trimmed = token.replace(/^[=,]+/, '').replace(/,+$/, '')
    if (isPathShaped(trimmed) && !DIRECTORY_CHANGE.has(previous)) {
      paths.add(trimmed)
    }
    previous = raw
  }
  return [...paths]
}
