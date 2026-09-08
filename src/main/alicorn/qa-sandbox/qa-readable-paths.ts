/**
 * What a blindfolded QA member may read inside its workspace.
 *
 * Deny is the default and the list is deliberately short: the requirement surface (docs and the
 * brief) plus the tests QA is there to write. A QA member that has read the implementation writes
 * tests that mirror it, bugs included — see PROJECT-BRIEF §09.
 *
 * Authored here, never on the member: a member cannot loosen its own criteria (CLAUDE.md).
 */
export const QA_READABLE_DIRECTORY_SEGMENTS = [
  '.foreman',
  'docs',
  'doc',
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'e2e'
] as const

/** `foo.test.ts`, `foo_spec.rb`, `foo-spec.js` — the conventions across the languages we host. */
const TEST_FILE_NAME = /[._-](?:test|spec)\.[^.]+$/
/** Requirements and acceptance criteria live in prose. */
const DOC_FILE_NAME = /\.mdx?$/

const READABLE_SEGMENTS = new Set<string>(QA_READABLE_DIRECTORY_SEGMENTS)

/**
 * Case-folded on every platform, not only the case-insensitive ones. Folding can only widen the
 * *allow* side, and a `Tests/` that does not exist on a case-sensitive host reads nothing; getting
 * this wrong the other way would let `SRC/Impl.ts` through on macOS.
 */
export function isQaReadableRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  // The workspace root itself is the whole implementation.
  if (!normalized || normalized === '.') {
    return false
  }
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.')
  if (segments.some((segment) => READABLE_SEGMENTS.has(segment.toLowerCase()))) {
    return true
  }
  const name = segments.at(-1)?.toLowerCase() ?? ''
  return TEST_FILE_NAME.test(name) || DOC_FILE_NAME.test(name)
}
