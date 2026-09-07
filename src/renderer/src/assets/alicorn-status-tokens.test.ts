import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainCss = fs.readFileSync(new URL('./main.css', import.meta.url), 'utf8')

function getCssRuleBody(selector: string): string {
  const ruleMarker = mainCss.indexOf(`\n${selector} {`)
  expect(ruleMarker).toBeGreaterThanOrEqual(0)

  const bodyStart = mainCss.indexOf('{', ruleMarker + 1) + 1
  const bodyEnd = mainCss.indexOf('\n}', bodyStart)
  return mainCss.slice(bodyStart, bodyEnd)
}

// DESIGN-SYSTEM.md "Tokens": this release adds exactly these five, each aliasing an existing token.
const ALIASES: readonly (readonly [string, string])[] = [
  ['--status-live', 'var(--status-success)'],
  ['--status-attention', 'var(--agent-question)'],
  ['--status-critical', 'var(--destructive)'],
  ['--focus-ring', '2px'],
  ['--motion-fast', '150ms']
]

describe('Alicorn status tokens', () => {
  it.each([':root', '.dark'])('declares all five aliases in %s', (selector) => {
    const body = getCssRuleBody(selector)
    for (const [name, value] of ALIASES) {
      expect(body).toContain(`${name}: ${value};`)
    }
  })

  it('exposes the three colour aliases as Tailwind theme colours', () => {
    const theme = getCssRuleBody('@theme inline')
    expect(theme).toContain('--color-status-live: var(--status-live);')
    expect(theme).toContain('--color-status-attention: var(--status-attention);')
    expect(theme).toContain('--color-status-critical: var(--status-critical);')
  })

  it('aliases only — no alias introduces a raw colour value', () => {
    for (const [name, value] of ALIASES) {
      if (!name.startsWith('--status-')) {
        continue
      }
      expect(value).toMatch(/^var\(--[a-z-]+\)$/)
    }
  })
})
