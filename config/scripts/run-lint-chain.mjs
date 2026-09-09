#!/usr/bin/env node
/**
 * Runs every lint step and reports all of them, instead of stopping at the first failure.
 *
 * Why this is not an `&&` chain any more: `oxlint` is the first step, so for as long as it was red
 * the fourteen behind it never executed at all. Five `import(no-duplicates)` warnings and a
 * `restrict-template-expressions` sat unrun that way until 6b9fcd26b made the chain green — the
 * output said "lint is failing" and named one file, while five other checks had not looked. A gate
 * that hides its own siblings teaches people that fixing the first error means they are done.
 *
 * Steps still run in order and one at a time: several read the whole source tree, and racing them
 * only makes them slower and their output interleaved.
 *
 * Usage: node config/scripts/run-lint-chain.mjs [--bail]
 *   --bail restores the old stop-at-first-failure behaviour, for a tight local loop.
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** The chain, in order. The first entry is a direct binary; the rest are package scripts. */
export const LINT_CHAIN_STEPS = [
  { name: 'oxlint', command: 'oxlint', args: [] },
  ...[
    'audit:code-quality:native',
    'audit:code-quality:type-aware',
    'check:reliability-gates',
    'check:max-lines-ratchet',
    'check:ts-nocheck-ratchet',
    'check:runtime-electron-ratchet',
    'verify:bundled-skill-guides',
    'verify:skill-bundle-manifest',
    'verify:rebrand-cli-gate',
    'verify:rebrand-env-gate',
    'verify:localization-catalog',
    'verify:localization-runtime-catalog',
    'verify:localization-extraction',
    'verify:localization-coverage'
  ].map((script) => ({ name: script, command: 'pnpm', args: ['run', script] }))
]

function runLintChain() {
  const bail = process.argv.includes('--bail')
  const failed = []

  for (const step of LINT_CHAIN_STEPS) {
    // Why inherit: these steps are read for their own output, and buffering it to re-print would
    // strip the colour and the interleaving that makes a long oxlint run legible.
    const result = spawnSync(step.command, step.args, {
      stdio: 'inherit',
      // Why: on Windows `oxlint` and `pnpm` are `.cmd` shims, which CreateProcess cannot exec.
      shell: process.platform === 'win32'
    })
    if (result.status !== 0) {
      failed.push(step.name)
      if (bail) {
        break
      }
    }
  }

  if (failed.length === 0) {
    console.log(`\nlint: all ${LINT_CHAIN_STEPS.length} steps passed.`)
    return 0
  }

  console.error(
    `\nlint: ${failed.length} of ${LINT_CHAIN_STEPS.length} step(s) failed:\n${failed
      .map((name) => `  - ${name}`)
      .join('\n')}`
  )
  if (bail) {
    console.error('  (--bail: the steps after the first failure were not run)')
  }
  return 1
}

// Why guarded: the parity test imports the step list, and importing it must not lint the repo.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runLintChain())
}
