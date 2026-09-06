import { isAbsolute, relative } from 'node:path'

export type DiffCoveragePerFile = { path: string; total: number; covered: number }

export type DiffCoverageResult = {
  total: number
  covered: number
  ratio: number
  perFile: DiffCoveragePerFile[]
}

function stripLeadingDotSlash(path: string): string {
  return path.startsWith('./') ? path.slice(2) : path
}

/** Default normalize passed by callers that know the worktree: strips './' and resolves an absolute lcov path against it. */
export function normalizeLcovPath(path: string, worktreePath: string): string {
  const stripped = stripLeadingDotSlash(path)
  return isAbsolute(stripped) ? relative(worktreePath, stripped) : stripped
}

/** Ratio of added lines (from the diff) covered by the lcov trace, plus a per-file breakdown. */
export function computeDiffCoverage(
  added: Map<string, Set<number>>,
  covered: Map<string, Set<number>>,
  opts?: { normalize?: (path: string) => string }
): DiffCoverageResult {
  const normalize = opts?.normalize ?? stripLeadingDotSlash
  const coveredByNormalizedPath = new Map<string, Set<number>>()
  for (const [path, lines] of covered) {
    coveredByNormalizedPath.set(normalize(path), lines)
  }

  let total = 0
  let coveredTotal = 0
  const perFile: DiffCoveragePerFile[] = []

  for (const [path, lines] of added) {
    const coveredLines = coveredByNormalizedPath.get(normalize(path))
    let fileCovered = 0
    for (const line of lines) {
      if (coveredLines?.has(line)) {
        fileCovered += 1
      }
    }
    total += lines.size
    coveredTotal += fileCovered
    perFile.push({ path, total: lines.size, covered: fileCovered })
  }

  return {
    total,
    covered: coveredTotal,
    // Why: an empty diff is trivially covered rather than an undefined 0/0.
    ratio: total === 0 ? 1 : coveredTotal / total,
    perFile
  }
}
