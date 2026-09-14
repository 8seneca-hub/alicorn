/**
 * `.alicorn/` — what Alicorn keeps inside a repository, and never commits.
 *
 * This follows the convention Orca already set with `.orca/`: a dot-directory in the worktree for
 * per-user state, and one line appended to `.gitignore` so it is never committed. See
 * `main/issue-command-file.ts` — `.orca/issue-command` is the same shape, and doing this a second
 * way would leave two answers to "where does this product put its per-repo state".
 *
 * Why not the repository root, and why not `CLAUDE.md`: both are tracked. A file at the root shows
 * up in everyone's diff, and an `@` import line edits a file the team owns — so using Alicorn would
 * mean committing to Alicorn. The context a member reads is this developer's, on this machine.
 *
 * Nothing here is expanded by the agent on its own. `CLAUDE.md` imports are, which is what the root
 * file bought; this directory reaches a member through the session's appended system prompt
 * instead, which is the documented place for facts that vary per session and per machine.
 */

export const ALICORN_DIR = '.alicorn'
export const ALICORN_CONTEXT_FILENAME = 'context.md'

/** The gitignore entry, matching how Orca spells `.orca`. */
export const ALICORN_DIR_IGNORE_ENTRY = ALICORN_DIR

export function alicornDirPath(repoPath: string): string {
  return `${repoPath.replace(/\/$/, '')}/${ALICORN_DIR}`
}

export function alicornContextPath(repoPath: string): string {
  return `${alicornDirPath(repoPath)}/${ALICORN_CONTEXT_FILENAME}`
}

/** True when `.gitignore` already excludes the directory, however the line is spelled. */
export function ignoresAlicornDir(gitignore: string): boolean {
  return /^\.alicorn\/?$/m.test(gitignore)
}

/**
 * `.gitignore` with the entry appended, or unchanged when it is already there.
 *
 * Returned rather than written so the caller owns the one write, and so an unchanged result can be
 * compared and skipped — rewriting a file with identical bytes still dirties a worktree watcher.
 */
export function addAlicornDirIgnore(gitignore: string): string {
  if (ignoresAlicornDir(gitignore)) {
    return gitignore
  }
  if (gitignore.trim().length === 0) {
    return `${ALICORN_DIR_IGNORE_ENTRY}\n`
  }
  const separator = gitignore.endsWith('\n') ? '' : '\n'
  return `${gitignore}${separator}${ALICORN_DIR_IGNORE_ENTRY}\n`
}
