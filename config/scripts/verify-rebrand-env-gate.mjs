#!/usr/bin/env node
/**
 * Ratchet gate for `ORCA_*` environment identifiers outside the relay stack.
 *
 * The rebrand renames the environment to `ALICORN_*` (task R4). An env var is the
 * worst kind of missed call site: nothing type-checks it, and a stale name reads as
 * "unset" — a hook that silently stops reporting rather than one that throws.
 *
 * So this compares the tree against a checked-in baseline of
 * `count <tab> path <tab> identifier`: an identifier with no unspent allowance for
 * that file fails, and the total may only shrink. Task R4's codemod drives the
 * baseline to zero, at which point the gate is zero-tolerance.
 *
 * Keying, learned the expensive way on the sibling `verify-rebrand-cli-gate.mjs`:
 *  - not `path:line` — editing any line above a baselined entry shifts every entry
 *    below it, and each shifted one reports as brand new (26 false findings once).
 *  - not the whole line — a generated file holding a guide as one single-line string
 *    means any edit rewrites that line and reads as a new site. Same bug, new costume.
 * The unit is the matched identifier itself, counted per file. A gate that cries wolf
 * trains people to re-baseline without reading, which is how a real finding launders through.
 *
 * Usage: node config/scripts/verify-rebrand-env-gate.mjs [--write]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Why absolute, not cwd-relative: `pnpm lint` runs from the repo root but CI steps and
// editors do not always — both sibling ratchets learned this the same way.
const ROOT = path.join(import.meta.dirname, '..', '..')
const BASELINE_PATH = path.join(ROOT, 'config', 'rebrand-env-baseline.txt')

/** Source extensions, for `src` where only real code carries an env name. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.cjs'])

/** Everything a build script, workflow or service config can be written in. */
const CONFIG_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.sh',
  '.bash',
  '.ps1',
  '.cmd',
  '.bat',
  '.env',
  '.toml',
  '.xml',
  '.html',
  '.plist',
  '.entitlements'
])

/**
 * The scan set. `.txt` is deliberately absent from every extension set so the baseline
 * does not scan itself, and `.md` so prose about the rename is not a finding.
 */
export const SCAN_TARGETS = [
  { dir: 'src', extensions: SOURCE_EXTENSIONS },
  { dir: 'config', extensions: CONFIG_EXTENSIONS },
  { dir: '.github', extensions: CONFIG_EXTENSIONS },
  { dir: 'cloud/apps/control-api', extensions: CONFIG_EXTENSIONS },
  { dir: 'cloud/apps/ledger-api', extensions: CONFIG_EXTENSIONS },
  { dir: 'cloud/packages', extensions: CONFIG_EXTENSIONS }
]

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.turbo',
  '.next'
])

/**
 * Files where `ORCA_` is the subject, not a leftover.
 *
 * The relay stack keeps its names: it is BC1's rename, on its own infrastructure timeline,
 * and R4 must not half-rename it. The compat layer and this gate (with its test) exist to
 * talk about the old names, so counting their mentions would baseline our own examples.
 */
export const ALLOWLIST_PATTERNS = [
  'src/shared/alicorn-env-compat.ts',
  'src/shared/alicorn-env-compat.test.ts',
  'config/scripts/verify-rebrand-env-gate.mjs',
  'config/scripts/verify-rebrand-env-gate.test.mjs',
  'cloud/apps/relay*/**',
  'cloud/infra/**',
  '.github/workflows/cloud-*.yml'
]

/** `**` crosses separators, a lone `*` does not. Enough glob for the patterns above. */
function globToRegExp(pattern) {
  const source = pattern
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*')
  return new RegExp(`^${source}$`)
}

const ALLOWLIST_REGEXPS = ALLOWLIST_PATTERNS.map(globToRegExp)

/** @param filePath {string} repo-relative, `/`-separated */
export function isAllowlisted(filePath) {
  return ALLOWLIST_REGEXPS.some((pattern) => pattern.test(filePath))
}

/**
 * An `ORCA_*` identifier. Uppercase on purpose: `orca_` in a lowercase word is prose or a
 * table name, and the word boundary keeps `MYORCA_X` and `_ORCA_X` out.
 */
export const ORCA_ENV_IDENTIFIER = /\bORCA_[A-Z0-9_]+/g

/** @param finding {{ path: string, text: string }} */
const identifierKey = (finding) => `${finding.path}\t${finding.text}`

/** @param files {Map<string, string>} repo-relative path → file content */
export function findOrcaEnvIdentifiers(files) {
  const findings = []
  for (const [filePath, content] of files) {
    if (isAllowlisted(filePath)) {
      continue
    }
    for (const [index, line] of content.split('\n').entries()) {
      for (const match of line.matchAll(ORCA_ENV_IDENTIFIER)) {
        findings.push({ path: filePath, line: index + 1, text: match[0] })
      }
    }
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
}

/**
 * Parse `count <tab> path <tab> identifier`. Strict on purpose: a malformed row must fail
 * loudly rather than silently allow nothing and bury the tree in false findings.
 *
 * @param text {string}
 * @returns {{ path: string, text: string, count: number }[]}
 */
export function readBaseline(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [count, filePath, identifier] = line.split('\t')
      if (!filePath || !identifier || !/^\d+$/.test(count ?? '')) {
        throw new Error(
          `Malformed baseline row ${JSON.stringify(line)}. Expected "count<TAB>path<TAB>identifier"; ` +
            'regenerate with `pnpm run verify:rebrand-env-gate -- --write`.'
        )
      }
      return { path: filePath, text: identifier, count: Number(count) }
    })
}

/**
 * Multiset comparison, keyed on file plus identifier.
 *
 * A finding is new when its file has no unspent allowance left for that exact identifier, so
 * moving code within a file reports nothing and introducing a name reports it. `retired` are
 * allowances the tree no longer uses — informational, because deleting them is the direction
 * R4 goes and must not cost a red build.
 *
 * Shrink-only needs no separate check: anything past its allowance lands in `newFindings`.
 */
export function compareAgainstBaseline(findings, baseline) {
  const remaining = new Map()
  let baselineCount = 0
  for (const entry of baseline) {
    const key = identifierKey(entry)
    remaining.set(key, (remaining.get(key) ?? 0) + entry.count)
    baselineCount += entry.count
  }

  const newFindings = []
  for (const finding of findings) {
    const key = identifierKey(finding)
    const allowance = remaining.get(key) ?? 0
    if (allowance > 0) {
      remaining.set(key, allowance - 1)
    } else {
      newFindings.push(finding)
    }
  }

  let retiredCount = 0
  for (const unspent of remaining.values()) {
    retiredCount += unspent
  }

  return { newFindings, allowedCount: findings.length, baselineCount, retiredCount }
}

function collectFiles() {
  const files = new Map()
  const walk = (dir, extensions) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path.join(dir, entry.name), extensions)
        }
      } else if (extensions.has(path.extname(entry.name))) {
        const absolutePath = path.join(dir, entry.name)
        files.set(
          path.relative(ROOT, absolutePath).split(path.sep).join('/'),
          readFileSync(absolutePath, 'utf8')
        )
      }
    }
  }
  for (const target of SCAN_TARGETS) {
    const absoluteDir = path.join(ROOT, ...target.dir.split('/'))
    if (statSync(absoluteDir, { throwIfNoEntry: false })?.isDirectory()) {
      walk(absoluteDir, target.extensions)
    }
  }
  return files
}

/** Findings per scan target, so the number R4's codemod drives to zero is legible. */
export function countByScanTarget(findings, targets = SCAN_TARGETS) {
  return targets.map((target) => ({
    dir: target.dir,
    count: findings.filter((finding) => finding.path.startsWith(`${target.dir}/`)).length
  }))
}

export function renderBaseline(findings) {
  const counts = new Map()
  for (const finding of findings) {
    const key = identifierKey(finding)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const rows = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => `${count}\t${key}`)

  return [
    '# `ORCA_*` environment identifiers left outside the relay stack.',
    '# Generated by config/scripts/verify-rebrand-env-gate.mjs --write.',
    '#',
    '# Format: count <TAB> path <TAB> identifier.',
    '# Keyed on the identifier, not the line number and not the line text, so moving code',
    '# is silent and adding a name is not. Review every added row: the point of the gate is',
    '# that a genuinely new `ORCA_*` name is visible in this diff.',
    '#',
    '# This list may only SHRINK. Rebrand task R4 empties it, and from then on any entry',
    '# fails the build. Read both names through `readAlicornEnv` and export both through',
    '# `withLegacyEnvAliases` (src/shared/alicorn-env-compat.ts) instead of adding a row.',
    '',
    ...rows
  ].join('\n')
}

function main() {
  const findings = findOrcaEnvIdentifiers(collectFiles())

  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE_PATH, `${renderBaseline(findings)}\n`)
    console.log(`Wrote ${findings.length} baselined identifier(s).`)
    for (const { dir, count } of countByScanTarget(findings)) {
      console.log(`  ${dir}: ${count}`)
    }
    return
  }

  const baseline = readBaseline(readFileSync(BASELINE_PATH, 'utf8'))
  const { newFindings, allowedCount, baselineCount, retiredCount } = compareAgainstBaseline(
    findings,
    baseline
  )

  if (newFindings.length > 0) {
    console.error(`Found ${newFindings.length} new \`ORCA_*\` environment identifier(s):\n`)
    for (const finding of newFindings.slice(0, 20)) {
      console.error(`  ${finding.path}:${finding.line}  ${finding.text}`)
    }
    if (newFindings.length > 20) {
      console.error(`  … and ${newFindings.length - 20} more.`)
    }
    console.error(
      '\nName it `ALICORN_*`. Read the legacy name through `readAlicornEnv` and export it through'
    )
    console.error('`withLegacyEnvAliases` (src/shared/alicorn-env-compat.ts) for one release.')
    console.error(
      'Moving baselined code does not land here, so each of these is a name new to its file.'
    )
    process.exitCode = 1
    return
  }

  const retired =
    retiredCount > 0
      ? `; ${retiredCount} baselined entr${retiredCount === 1 ? 'y' : 'ies'} gone, run --write to tighten`
      : ''
  const breakdown = countByScanTarget(findings)
    .map(({ dir, count }) => `${dir} ${count}`)
    .join(', ')
  console.log(
    `Rebrand env gate passed: ${allowedCount} \`ORCA_*\` identifier(s), baseline ${baselineCount}${retired}.`
  )
  console.log(`  ${breakdown}`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main()
}
