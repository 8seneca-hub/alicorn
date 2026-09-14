/**
 * Keeping `.alicorn/context.md` current, without asking.
 *
 * The consent card this replaces existed because the old design wrote into two files the team owns
 * — a root `ALICORN.md` and an `@` import line in `CLAUDE.md`. Writing into someone's tracked files
 * is a thing to ask about. Writing into an ignored directory Alicorn owns is not, any more than
 * Orca asks before writing `.orca/issue-command`, so this just does it.
 *
 * Regenerated whenever the facts change, because a stale description of the pipeline is worse than
 * none: a member reads it as current. Only Alicorn's own block is replaced, so anything a developer
 * adds to the file survives.
 */
import React from 'react'
import { describeFailure } from '../../../../../shared/alicorn/describe-failure'
import { renderAlicornMd, upsertAlicornBlock } from '../../../../../shared/alicorn/alicorn-md'
import type { AlicornMdFacts } from '../../../../../shared/alicorn/alicorn-md'
import {
  addAlicornDirIgnore,
  alicornContextPath
} from '../../../../../shared/alicorn/alicorn-project-dir'

async function readIfPresent(filePath: string): Promise<string> {
  try {
    const read = await window.api?.fs?.readFile({ filePath })
    return read && !read.isBinary ? read.content : ''
  } catch {
    // Absent is the ordinary case for both files here, and not a failure.
    return ''
  }
}

export type AlicornProjectDirState = {
  /** Where the context file is, once written; null while there is nowhere to write it. */
  path: string | null
  error: string | null
}

export function useAlicornProjectDir(
  /** Null when no repository resolves on this machine — nothing to write into. */
  repoPath: string | null,
  facts: AlicornMdFacts
): AlicornProjectDirState {
  const [error, setError] = React.useState<string | null>(null)
  const root = repoPath ? repoPath.replace(/\/$/, '') : null
  const block = React.useMemo(() => renderAlicornMd(facts), [facts])

  React.useEffect(() => {
    if (!root) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const contextPath = alicornContextPath(root)
        const existing = await readIfPresent(contextPath)
        const next = upsertAlicornBlock(existing, block)
        if (next !== existing) {
          await window.api.fs.writeFile({ filePath: contextPath, content: next })
        }
        // Second, and only after the file exists: an ignore rule for a directory that is not there
        // is a line in someone's diff explaining nothing.
        const gitignorePath = `${root}/.gitignore`
        const gitignore = await readIfPresent(gitignorePath)
        const withIgnore = addAlicornDirIgnore(gitignore)
        if (withIgnore !== gitignore) {
          await window.api.fs.writeFile({ filePath: gitignorePath, content: withIgnore })
        }
        if (!cancelled) {
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(describeFailure(cause))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [block, root])

  return { path: root ? alicornContextPath(root) : null, error }
}
