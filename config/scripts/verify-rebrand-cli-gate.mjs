#!/usr/bin/env node
/**
 * Ratchet gate for bare `orca` CLI invocations in the skill corpus.
 *
 * The rebrand renames the CLI to `alicorn`, and the skill corpus is where a
 * missed call site does the most damage: a guide that tells an agent to run
 * `orca status` keeps working right up until the compat shim is removed, then
 * fails in someone else's session with no stack trace pointing here.
 *
 * A grep is enough to find them, but a one-off grep does not stop new ones
 * arriving while the rename is in flight. So this compares the findings to a
 * checked-in baseline of `count <tab> path <tab> invocation text`: a call site
 * whose text is not already allowed for that file fails, and the total may only
 * shrink. Task R3 empties the baseline, at which point the gate is
 * zero-tolerance.
 *
 * Why text and not `path:line`: line numbers are not stable. Editing any line
 * above a baselined entry shifted every entry below it, and each one reported as
 * a brand-new invocation — 26 false findings from two unrelated commits, one of
 * which was real. A gate that cries wolf trains people to re-baseline without
 * reading, which is how the one real finding gets laundered through.
 *
 * Why the invocation and not the whole line: `src/cli/bundled-skill-guides.ts` is
 * generated and holds each guide as one single-line string literal, so keying on
 * the line meant *any* edit to *any* guide rewrote that line and reported it as a
 * new call site. That is the same false positive in a new costume — the unit has
 * to be the call site itself, which is what the baseline claims to hold.
 *
 * Usage: node config/scripts/verify-rebrand-cli-gate.mjs [--write]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Why absolute, not cwd-relative: `pnpm lint` runs from the repo root but CI steps
// and editors do not always — the sibling ratchet learned this the same way.
const ROOT = path.join(import.meta.dirname, '..', '..')
const BASELINE_PATH = path.join(ROOT, 'config', 'rebrand-cli-baseline.txt')

/** Directories whose every text file is scanned, plus the generated bundle. */
const SCAN_DIRS = ['skills', 'skill-guides', 'skill-stubs']
const SCAN_FILES = ['src/cli/bundled-skill-guides.ts']

const SCAN_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.ts',
  '.js',
  '.mjs',
  '.json',
  '.yaml',
  '.yml'
])

/**
 * A bare invocation: `orca` (or `orca-dev`) as a command, followed by a
 * subcommand word.
 *
 * The leading class excludes the characters that make it something else —
 * `/usr/local/bin/orca` is a path, `orca-ide` is the Linux binary, and an
 * alphanumeric prefix means it is part of a longer word. Case-sensitive on
 * purpose: "GNOME Orca" is a different product and must not be rewritten.
 */
export const BARE_ORCA_INVOCATION = /(^|[^A-Za-z0-9_/-])orca(?:-dev)? [a-z]/

/** The same match, capturing command plus subcommand so a finding names the call site. */
const BARE_ORCA_INVOCATION_GLOBAL = /(^|[^A-Za-z0-9_/-])(orca(?:-dev)? [a-z][\w-]*)/g

/**
 * Trim and collapse runs of whitespace, so re-indenting a list item or a
 * Prettier reflow does not read as a different call site. Collapsing tabs is
 * also what makes tab safe as the baseline's field separator.
 *
 * @param text {string}
 */
export function normalizeInvocationText(text) {
  return text.trim().replace(/\s+/g, ' ')
}

/** @param finding {{ path: string, text: string }} */
const invocationKey = (finding) => `${finding.path}\t${finding.text}`

/** @param files {Map<string, string>} repo-relative path → file content */
export function findBareOrcaInvocations(files) {
  const findings = []
  for (const [filePath, content] of files) {
    const lines = content.split('\n')
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(BARE_ORCA_INVOCATION_GLOBAL)) {
        findings.push({
          path: filePath,
          line: index + 1,
          text: normalizeInvocationText(match[2])
        })
      }
    }
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
}

/**
 * Parse `count <tab> path <tab> invocation text` rows. Strict on purpose: the
 * old `path:line` baseline must fail loudly rather than silently allow nothing.
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
      const [count, filePath, invocation] = line.split('\t')
      if (!filePath || !invocation || !/^\d+$/.test(count ?? '')) {
        throw new Error(
          `Malformed baseline row ${JSON.stringify(line)}. Expected "count<TAB>path<TAB>invocation"; ` +
            'regenerate with `pnpm run verify:rebrand-cli-gate -- --write`.'
        )
      }
      return { path: filePath, text: invocation, count: Number(count) }
    })
}

/**
 * Multiset comparison, keyed on file plus normalised invocation text.
 *
 * A finding is new when its file has no unspent allowance left for that exact
 * text, so moving a baselined line reports nothing and rewording one reports it.
 * `retired` are allowances the corpus no longer uses — informational, because
 * deleting call sites is the direction we want and must not cost a red build.
 *
 * The shrink-only property needs no separate check: every finding past its
 * allowance lands in `newFindings`, so a grown total cannot come back clean.
 */
export function compareAgainstBaseline(findings, baseline) {
  const remaining = new Map()
  let baselineCount = 0
  for (const entry of baseline) {
    const key = invocationKey(entry)
    remaining.set(key, (remaining.get(key) ?? 0) + entry.count)
    baselineCount += entry.count
  }

  const newFindings = []
  for (const finding of findings) {
    const key = invocationKey(finding)
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
  const addFile = (absolutePath) => {
    const relative = path.relative(ROOT, absolutePath).split(path.sep).join('/')
    files.set(relative, readFileSync(absolutePath, 'utf8'))
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(absolutePath)
      } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
        addFile(absolutePath)
      }
    }
  }
  for (const dir of SCAN_DIRS) {
    const absoluteDir = path.join(ROOT, dir)
    if (statSync(absoluteDir, { throwIfNoEntry: false })?.isDirectory()) {
      walk(absoluteDir)
    }
  }
  for (const file of SCAN_FILES) {
    const absolutePath = path.join(ROOT, file)
    if (statSync(absolutePath, { throwIfNoEntry: false })?.isFile()) {
      addFile(absolutePath)
    }
  }
  return files
}

export function renderBaseline(findings) {
  const counts = new Map()
  for (const finding of findings) {
    const key = invocationKey(finding)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const rows = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => `${count}\t${key}`)

  return [
    '# Bare `orca <subcommand>` invocations left in the skill corpus.',
    '# Generated by config/scripts/verify-rebrand-cli-gate.mjs --write.',
    '#',
    '# Format: count <TAB> path <TAB> the invocation line, whitespace-collapsed.',
    '# Keyed on text, not line number, so moving a line is silent and changing one',
    '# is not. Review every added row: the point of the gate is that a genuinely new',
    '# call site is visible in this diff.',
    '#',
    '# This list may only SHRINK. Rebrand task R3 empties it, and from then on any',
    '# entry fails the build — a guide that still says `orca` breaks once the',
    '# compat shim is removed.',
    '',
    ...rows
  ].join('\n')
}

function main() {
  const findings = findBareOrcaInvocations(collectFiles())

  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE_PATH, `${renderBaseline(findings)}\n`)
    console.log(`Wrote ${findings.length} baselined invocation(s).`)
    return
  }

  const baseline = readBaseline(readFileSync(BASELINE_PATH, 'utf8'))
  const { newFindings, allowedCount, baselineCount, retiredCount } = compareAgainstBaseline(
    findings,
    baseline
  )

  if (newFindings.length > 0) {
    console.error(`Found ${newFindings.length} new bare \`orca\` invocation(s):\n`)
    for (const finding of newFindings.slice(0, 20)) {
      console.error(`  ${finding.path}:${finding.line}  ${finding.text}`)
    }
    if (newFindings.length > 20) {
      console.error(`  … and ${newFindings.length - 20} more.`)
    }
    console.error('\nUse `alicorn` instead. The skill corpus must not gain new `orca` call sites.')
    console.error(
      'Moving a baselined line does not land here, so each of these is a call site whose text is new to its file.'
    )
    process.exitCode = 1
    return
  }

  const retired =
    retiredCount > 0
      ? `; ${retiredCount} baselined entr${retiredCount === 1 ? 'y' : 'ies'} gone, run --write to tighten`
      : ''
  console.log(
    `Rebrand CLI gate passed: ${allowedCount} bare \`orca\` invocation(s), baseline ${baselineCount}${retired}.`
  )
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main()
}
