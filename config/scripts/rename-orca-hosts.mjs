#!/usr/bin/env node
/**
 * One-shot codemod: `*.onorca.dev` → `*.alicorn.8seneca.com` (BC2).
 *
 * Same posture as `rename-orca-env.mjs`: a host rename done by hand across 79 files is how one
 * call site gets missed, and a missed endpoint is a build whose auth or relay silently points at
 * a domain we no longer control.
 *
 * The mapping is deliberately total and mechanical — every label is preserved, only the zone
 * changes — so `login.`, `relay.`, `relay-c1.`, `share.`, `api.`, `www.` and the bare `.onorca.dev`
 * cookie-domain suffix all move together and the result is auditable by one grep.
 *
 * Usage: node config/scripts/rename-orca-hosts.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.join(import.meta.dirname, '..', '..')
const OLD_ZONE = 'onorca.dev'
const NEW_ZONE = 'alicorn.8seneca.com'
const SEARCH_DIRS = ['src', 'config', 'cloud', 'docs', '.github']

const check = process.argv.includes('--check')

function trackedFilesContaining(needle) {
  try {
    return execFileSync('git', ['grep', '-l', '--fixed-strings', needle, '--', ...SEARCH_DIRS], {
      cwd: ROOT,
      encoding: 'utf8'
    })
      .split('\n')
      .filter(Boolean)
  } catch {
    // git grep exits non-zero when nothing matches, which is the finished state.
    return []
  }
}

const files = trackedFilesContaining(OLD_ZONE)
let rewritten = 0
let occurrences = 0

for (const file of files) {
  const absolute = path.join(ROOT, file)
  const before = readFileSync(absolute, 'utf8')
  const matches = before.split(OLD_ZONE).length - 1
  const after = before.replaceAll(OLD_ZONE, NEW_ZONE)
  if (after === before) {
    continue
  }
  occurrences += matches
  rewritten += 1
  if (!check) {
    writeFileSync(absolute, after, 'utf8')
  }
}

console.log(
  `${check ? 'would rewrite' : 'rewrote'} ${occurrences} occurrence(s) of ${OLD_ZONE} across ${rewritten} file(s)`
)
if (check && rewritten > 0) {
  process.exit(1)
}
