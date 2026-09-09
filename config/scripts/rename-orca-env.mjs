#!/usr/bin/env node
/**
 * One-shot R4 codemod: `ORCA_*` → `ALICORN_*` environment identifiers.
 *
 * Companion to `verify-rebrand-env-gate.mjs`, which measures what is left. This writes the
 * rename; the gate proves it landed. Both share one regex and one allowlist so the codemod
 * can never rewrite a file the gate has decided is exempt (the compat layer, the gate's own
 * fixtures, and the relay stack — BC1's rename, on its own infrastructure timeline).
 *
 * Scope is wider than the gate's, deliberately: the gate scans only `src`, `config` and
 * `.github` with a source/config extension set, but `tests`, `mobile`, `native`, `resources`
 * and the root build configs all carry the same names, and a half-renamed tree is the failure
 * mode CLAUDE.md names — "a partial rename makes the CI grep gate lie".
 *
 * Prose is skipped, not renamed: `CLAUDE.md`, `AGENTS.md` and the rebrand plans *discuss*
 * `ORCA_*` by name, and rewriting them turns "keeps its ORCA_ names until the sweep" into a
 * sentence that says nothing.
 *
 * Usage:
 *   node config/scripts/rename-orca-env.mjs --check   # counts per top-level directory, no writes
 *   node config/scripts/rename-orca-env.mjs --write
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { ROOT, isAllowlisted } from './verify-rebrand-env-gate.mjs'

/**
 * Deliberately one notch stricter than the gate's `\bORCA_…`.
 *
 * `\b` needs a non-word character before the O, and inside a JS string an escape sequence
 * supplies a word character: `'PORT=9\nORCA_TOKEN=x'` reads as `n` + `ORCA_TOKEN`, so `\b`
 * skips it — and so does the gate, which is how a half-renamed heredoc terminator and four
 * half-renamed endpoint fixtures survived the first sweep with the gate reporting zero.
 * A lookbehind on the identifier character class instead still keeps `MYORCA_X` and the
 * `__ORCA_*` stdout sentinels (which are not env names) out.
 */
export const ALICORN_ENV_IDENTIFIER = /(?<![A-Z0-9_])ORCA_([A-Z0-9_]+)/g

export function renameOrcaEnvIdentifiers(text) {
  return text.replace(ALICORN_ENV_IDENTIFIER, 'ALICORN_$1')
}

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'coverage',
  '.turbo',
  '.next',
  '.foreman'
])

/** Directory prefixes the codemod must not enter, repo-relative and `/`-separated. */
const SKIPPED_PREFIXES = [
  // The relay stack's rename is BC1's; `cloud/apps/control-api|ledger-api|packages` hold none.
  'cloud/',
  // Planning records that argue about the rename by name.
  'docs/alicorn/plans/'
]

const SKIPPED_FILES = new Set(['config/rebrand-env-baseline.txt', 'CLAUDE.md'])

/** @param filePath {string} repo-relative, `/`-separated */
export function isSkipped(filePath) {
  return (
    isAllowlisted(filePath) ||
    SKIPPED_FILES.has(filePath) ||
    path.posix.basename(filePath) === 'AGENTS.md' ||
    SKIPPED_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  )
}

/** Cheap binary sniff: a NUL byte in the first 4 KiB. Cheaper than an extension denylist that
 *  has to know about `.icns`, and it also covers extensionless shipped shims like
 *  `resources/darwin/bin/alicorn`, which do carry `ORCA_*`. */
function isBinary(buffer) {
  return buffer.subarray(0, 4096).includes(0)
}

/** @returns {{ path: string, content: string }[]} every candidate file, in walk order. */
export function collectCandidateFiles(root = ROOT) {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const absolutePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(absolutePath)
        }
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
      if (isSkipped(relativePath)) {
        continue
      }
      const buffer = readFileSync(absolutePath)
      if (isBinary(buffer)) {
        continue
      }
      files.push({ path: relativePath, content: buffer.toString('utf8') })
    }
  }
  walk(root)
  return files
}

/** Occurrences and files per top-level directory — the number the sweep drives to zero. */
export function countByTopLevelDirectory(files) {
  const counts = new Map()
  for (const file of files) {
    const matches = file.content.match(ALICORN_ENV_IDENTIFIER)
    if (!matches) {
      continue
    }
    const top = file.path.includes('/') ? file.path.slice(0, file.path.indexOf('/')) : '.'
    const bucket = counts.get(top) ?? { occurrences: 0, files: 0 }
    bucket.occurrences += matches.length
    bucket.files += 1
    counts.set(top, bucket)
  }
  return [...counts.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences)
}

function main() {
  const write = process.argv.includes('--write')
  if (!write && !process.argv.includes('--check')) {
    console.error('Pass --check (counts only) or --write.')
    process.exitCode = 2
    return
  }

  const files = collectCandidateFiles()
  let totalOccurrences = 0
  let changedFiles = 0
  for (const [top, { occurrences, files: fileCount }] of countByTopLevelDirectory(files)) {
    totalOccurrences += occurrences
    changedFiles += fileCount
    console.log(`  ${top}: ${occurrences} occurrence(s) in ${fileCount} file(s)`)
  }
  console.log(`${totalOccurrences} occurrence(s) across ${changedFiles} file(s).`)

  if (!write) {
    return
  }
  for (const file of files) {
    const renamed = renameOrcaEnvIdentifiers(file.content)
    if (renamed !== file.content) {
      writeFileSync(path.join(ROOT, ...file.path.split('/')), renamed)
    }
  }
  console.log(`Rewrote ${changedFiles} file(s).`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (!statSync(ROOT, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Repository root not found: ${ROOT}`)
  }
  main()
}
