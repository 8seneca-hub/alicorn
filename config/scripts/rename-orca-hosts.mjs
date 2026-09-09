#!/usr/bin/env node
/**
 * One-shot codemod: `*.alicorn.8seneca.com` → `*.alicorn.8seneca.com` (BC2).
 *
 * Same posture as `rename-orca-env.mjs`: a host rename done by hand across 79 files is how one
 * call site gets missed, and a missed endpoint is a build whose auth or relay silently points at
 * a domain we no longer control.
 *
 * The mapping is deliberately total and mechanical — every label is preserved, only the zone
 * changes — so `login.`, `relay.`, `relay-c1.`, `share.`, `api.`, `www.` and the bare `.alicorn.8seneca.com`
 * cookie-domain suffix all move together and the result is auditable by one grep.
 *
 * Applied 2026-09-10 (567 occurrences, 122 files). It survives as the `--check` gate: a new
 * `onorca.dev` reference fails, which is the only thing that stops the zone creeping back in.
 *
 * Out of scope, deliberately: `onorca-cloud*` GCP project ids and Terraform state buckets. Those
 * are BC1's rename and they name resources that must be created before anything may point at them.
 *
 * Usage: node config/scripts/rename-orca-hosts.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.join(import.meta.dirname, '..', '..')
// Assembled rather than written whole: this script is inside its own search path, and a literal
// here would rewrite the constants on the first run — leaving OLD_ZONE === NEW_ZONE and a --check
// that reports success because it is looking for the wrong string. It did exactly that once.
const OLD_ZONE = ['onorca', 'dev'].join('.')
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

const SELF = path.relative(ROOT, import.meta.filename)

for (const file of files) {
  if (file === SELF) {
    continue
  }
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
