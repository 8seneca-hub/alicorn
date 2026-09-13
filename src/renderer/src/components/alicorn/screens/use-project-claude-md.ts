/**
 * A project's CLAUDE.md — the file, when there is one.
 *
 * The file is the artifact, not a copy of it. Claude reads `CLAUDE.md` out of the working directory
 * on its own, so a context kept only in the control plane is a second description of the project
 * that the agent never sees, and the two drift the moment someone edits either. Where the file
 * exists, it wins.
 *
 * The control-plane `context` is the seed and the fallback: an imported project has its board's
 * description before it has a repository worth reading, and a project whose repo has no CLAUDE.md
 * still has something to say.
 */
import React from 'react'

export const CLAUDE_MD = 'CLAUDE.md'

export type ProjectClaudeMd = {
  /** What to show: the file when it exists, else the control-plane context. */
  text: string
  /** Absolute path the file would be written to, or null when no repository is resolved here. */
  path: string | null
  /** True when `text` came from the file rather than the control plane. */
  fromFile: boolean
  loading: boolean
  reload: () => void
}

export function useProjectClaudeMd(args: {
  /** The project's primary repository on this machine. */
  repoPath: string | null
  /** The control-plane context: the seed an import wrote, and the fallback. */
  fallback: string
}): ProjectClaudeMd {
  const { repoPath, fallback } = args
  const [text, setText] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [reloads, setReloads] = React.useState(0)
  const path = repoPath ? `${repoPath.replace(/\/$/, '')}/${CLAUDE_MD}` : null

  React.useEffect(() => {
    if (!path) {
      setText(null)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const read = await window.api?.fs?.readFile({ filePath: path })
        if (!cancelled) {
          // A binary CLAUDE.md is not a CLAUDE.md; fall back rather than render bytes.
          setText(read && !read.isBinary ? read.content : null)
        }
      } catch {
        // Absent is the common case, not an error: most projects have no CLAUDE.md yet.
        if (!cancelled) {
          setText(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, reloads])

  return {
    text: text ?? fallback,
    path,
    fromFile: text !== null,
    loading,
    reload: () => setReloads((count) => count + 1)
  }
}

export async function writeProjectClaudeMd(path: string, content: string): Promise<void> {
  await window.api.fs.writeFile({ filePath: path, content })
}
