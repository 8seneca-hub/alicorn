#!/usr/bin/env node
/**
 * One-shot codemod for the rebrand (R3): every bare `orca <subcommand>` becomes
 * `alicorn <subcommand>`.
 *
 * The match is imported from the gate rather than restated, so the codemod and
 * `verify:rebrand-cli-gate` cannot disagree about what a call site is — a second
 * regex here would drift and leave findings the gate then fails on.
 *
 * Usage: node config/scripts/rewrite-skill-corpus-cli.mjs <path…>
 * A path may be a file or a directory (walked for text files).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { REWRITABLE_ORCA_INVOCATION_GLOBAL } from './verify-rebrand-cli-gate.mjs'

const REWRITABLE_EXTENSIONS = new Set([
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
 * Replace every bare `orca <subcommand>` with `alicorn <subcommand>`, keeping
 * the character the match needed in front of it (a backtick, a `$(`, a space).
 *
 * @param text {string}
 */
export function rewriteBareOrcaInvocations(text) {
  return text.replace(
    REWRITABLE_ORCA_INVOCATION_GLOBAL,
    (_match, lead, invocation) => `${lead}alicorn${invocation.slice('orca'.length)}`
  )
}

function* walk(target) {
  if (statSync(target).isDirectory()) {
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      yield* walk(path.join(target, entry.name))
    }
    return
  }
  if (REWRITABLE_EXTENSIONS.has(path.extname(target))) {
    yield target
  }
}

function main(targets) {
  let changed = 0
  for (const target of targets) {
    for (const filePath of walk(target)) {
      const before = readFileSync(filePath, 'utf8')
      const after = rewriteBareOrcaInvocations(before)
      if (after !== before) {
        writeFileSync(filePath, after)
        changed += 1
      }
    }
  }
  console.log(`Rewrote ${changed} file(s).`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const targets = process.argv.slice(2)
  if (targets.length === 0) {
    console.error('Usage: node config/scripts/rewrite-skill-corpus-cli.mjs <path…>')
    process.exitCode = 1
  } else {
    main(targets)
  }
}
