// Hand-mirrored from cloud/packages/control-plane-contract/src/protected-path.ts.
// Field names must stay identical — the desktop does not import the contract package,
// so a rename there is a silent break here.

/**
 * The reach half of a blast-radius budget (BR1). Authored per project by an org admin; nothing on
 * the worker side writes here, because a member cannot loosen its own criteria.
 */
export type ProtectedPath =
  | { kind: 'path'; path: string; reason?: string }
  | { kind: 'extension'; extension: string; reason?: string }

export type ProtectedPathMatch = { path: string; rule: ProtectedPath }

/**
 * Whether a run's changed files reached anything protected.
 *
 * `touched: null` and `touched: false` are different answers and `evaluateGate` treats them
 * differently: `false` is "we looked and nothing protected was touched", `null` is "we could not
 * look", which reads as `unverified` rather than `blast:reach` so the recorded reason says which
 * of the two actually happened.
 */
export type ProtectedPathReach =
  | { touched: true; matches: ProtectedPathMatch[] }
  | { touched: false }
  | { touched: null; reason: string }

/**
 * Repo-relative, POSIX, case-folded — or null when the value is not a repo-relative path at all.
 *
 * Case-folded on every platform, not only the case-insensitive ones. Folding can only widen the
 * *protected* side, and an over-protected path costs one extra gate; the other direction lets
 * `Infra/main.tf` past a rule protecting `infra` on macOS. Same reasoning as
 * `isQaReadableRelativePath`, opposite polarity.
 *
 * No symlink resolution, deliberately: these paths come from `git diff --name-only`, which reports
 * the tracked path of the entry itself. `resolveQaPath` canonicalises because there the path is
 * agent-authored and the agent is the adversary; here git is the author.
 */
function normalizeRepoRelativePath(value: string): string | null {
  const slashed = value.trim().replaceAll('\\', '/')
  if (!slashed || slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    return null
  }
  const segments: string[] = []
  for (const segment of slashed.split('/')) {
    if (!segment || segment === '.') {
      continue
    }
    // Never emitted by git; if one arrives, the path is not something we can place in a repo.
    if (segment === '..') {
      return null
    }
    segments.push(segment)
  }
  return segments.length ? segments.join('/').toLowerCase() : null
}

function normalizeExtension(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/^\.+/, '')
  return trimmed && !trimmed.includes('/') && !trimmed.includes('\\') ? `.${trimmed}` : null
}

function matchesRule(normalizedPath: string, rule: ProtectedPath): boolean | null {
  if (rule.kind === 'extension') {
    const extension = normalizeExtension(rule.extension)
    return extension === null ? null : normalizedPath.endsWith(extension)
  }
  const prefix = normalizeRepoRelativePath(rule.path)
  if (prefix === null) {
    return null
  }
  // The `/` is what keeps `srcfoo/a.ts` out of a rule protecting `src`.
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
}

/**
 * Did this run reach a protected path?
 *
 * An empty surface answers `false` even when the changed files could not be read: nothing is
 * protected, so no file set can reach it, and that is knowable without looking. Without this, BR1
 * would turn every gate on every project that has authored nothing into an `unverified` — a
 * regression dressed as caution.
 */
export function resolveProtectedPathReach(
  changedPaths: readonly string[] | null,
  rules: readonly ProtectedPath[]
): ProtectedPathReach {
  if (rules.length === 0) {
    return { touched: false }
  }
  if (changedPaths === null) {
    return { touched: null, reason: 'the run’s changed files could not be read' }
  }
  const matches: ProtectedPathMatch[] = []
  for (const path of changedPaths) {
    const normalized = normalizeRepoRelativePath(path)
    if (normalized === null) {
      return { touched: null, reason: `a changed path could not be placed in the repository` }
    }
    for (const rule of rules) {
      const matched = matchesRule(normalized, rule)
      // An authored rule we cannot read is not permission: the surface is unknown, not empty.
      if (matched === null) {
        return { touched: null, reason: 'a protected path rule could not be read' }
      }
      if (matched) {
        matches.push({ path, rule })
        break
      }
    }
  }
  return matches.length ? { touched: true, matches } : { touched: false }
}
