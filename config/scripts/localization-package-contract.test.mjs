import { LINT_CHAIN_STEPS } from './run-lint-chain.mjs'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('localization package scripts', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts

  it('keeps safe catalog and extraction verification available', () => {
    expect(scripts['verify:localization-catalog']).toBeDefined()
    expect(scripts['sync:localization-catalog']).toBeDefined()
    expect(scripts['verify:localization-extraction']).toBeDefined()
  })

  it('keeps the runtime-required English subset generated and checked', () => {
    expect(scripts['verify:localization-runtime-catalog']).toBeDefined()
    expect(scripts['sync:localization-runtime-catalog']).toBeDefined()
    // The chain lives in the runner now, so the assertion follows it there: `scripts.lint` is
    // just the runner's path, and a substring check against it would pass on any chain at all.
    expect(LINT_CHAIN_STEPS.map((step) => step.name)).toContain(
      'verify:localization-runtime-catalog'
    )
  })

  it('does not expose whole-catalog translation and repair commands', () => {
    expect(scripts['bootstrap:locale-catalog']).toBeUndefined()
    expect(scripts['bootstrap:zh-catalog']).toBeUndefined()
    expect(scripts['bootstrap:ko-catalog']).toBeUndefined()
    expect(scripts['bootstrap:ja-catalog']).toBeUndefined()
    expect(scripts['bootstrap:es-catalog']).toBeUndefined()
    expect(scripts['repair:locale-catalog']).toBeUndefined()
  })
})
