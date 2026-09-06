/** Parses an lcov trace: SF path -> covered (hits > 0) line numbers, reset per end_of_record. */
export function parseLcov(text: string): Map<string, Set<number>> {
  const covered = new Map<string, Set<number>>()
  let current: Set<number> | undefined

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('SF:')) {
      const path = line.slice('SF:'.length)
      current = covered.get(path) ?? new Set<number>()
      covered.set(path, current)
    } else if (line.startsWith('DA:') && current) {
      const [lineNoText, hitsText] = line.slice('DA:'.length).split(',')
      if (Number(hitsText) > 0) {
        current.add(Number(lineNoText))
      }
    } else if (line === 'end_of_record') {
      current = undefined
    }
  }

  return covered
}
