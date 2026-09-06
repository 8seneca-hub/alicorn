const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** From `git diff -U0`: maps each new-file path to the line numbers its `+` lines land on. */
export function addedLinesFromUnifiedDiff(text: string): Map<string, Set<number>> {
  const added = new Map<string, Set<number>>()
  let currentPath: string | undefined
  let cursor = 0
  // Consumed from the hunk header's declared `+c,d` count, not re-derived per line: an
  // added line whose own content starts with '++ ' would otherwise read as a '+++ ' header.
  let remainingAdded = 0

  for (const line of text.split('\n')) {
    if (remainingAdded > 0 && line.startsWith('+')) {
      if (currentPath) {
        const lines = added.get(currentPath) ?? new Set<number>()
        lines.add(cursor)
        added.set(currentPath, lines)
      }
      cursor += 1
      remainingAdded -= 1
      continue
    }
    if (line.startsWith('+++ ')) {
      const path = line.slice('+++ '.length).trim()
      currentPath = path === '/dev/null' ? undefined : stripDiffPrefix(path)
      continue
    }
    const hunk = HUNK_HEADER.exec(line)
    if (hunk) {
      cursor = Number(hunk[1])
      remainingAdded = hunk[2] !== undefined ? Number(hunk[2]) : 1
      continue
    }
  }

  return added
}

function stripDiffPrefix(path: string): string {
  return path.startsWith('b/') ? path.slice(2) : path
}
