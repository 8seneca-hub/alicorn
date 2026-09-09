import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LINT_CHAIN_STEPS } from './run-lint-chain.mjs'

const ROOT = path.join(import.meta.dirname, '..', '..')
const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

describe('the lint chain', () => {
  // Why this is pinned: an `&&` chain is exactly the shape that hid fourteen steps behind oxlint.
  // Re-adding one would restore the defect with no test failing anywhere else.
  it('is one runner, not a chain that stops at the first failure', () => {
    expect(packageJson.scripts.lint).toBe('node config/scripts/run-lint-chain.mjs')
    expect(packageJson.scripts.lint).not.toContain('&&')
  })

  it('names only scripts that exist, so a renamed step fails here and not in CI', () => {
    const missing = LINT_CHAIN_STEPS.filter(
      (step) => step.command === 'pnpm' && !packageJson.scripts[step.args[1]]
    ).map((step) => step.name)

    expect(missing).toEqual([])
  })

  it('still runs every gate the chain used to run', () => {
    const names = LINT_CHAIN_STEPS.map((step) => step.name)

    expect(names[0]).toBe('oxlint')
    for (const required of [
      'audit:code-quality:native',
      'audit:code-quality:type-aware',
      'check:max-lines-ratchet',
      'verify:rebrand-cli-gate',
      'verify:rebrand-env-gate',
      'verify:localization-coverage'
    ]) {
      expect(names).toContain(required)
    }
  })
})
