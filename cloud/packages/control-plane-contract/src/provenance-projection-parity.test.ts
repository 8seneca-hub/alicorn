import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The desktop and the cloud are separate pnpm workspaces, so the one provenance projection has to
 * exist as two files. This is what stops them being two projections: the bodies must match byte for
 * byte once the import block — the only part that legitimately differs — is removed.
 *
 * If this fails, do not edit one side to match. Change the canonical copy here, then copy the body
 * across. A signed export that disagrees with the panel is the failure PV2 exists to prevent.
 */
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')

/** Everything after the imports: leading comments and the import statements themselves are dropped. */
function body(source: string): string {
  const lines = source.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '' || line.trimStart().startsWith('//')) {
      index += 1
      continue
    }
    if (/^import\b/.test(line)) {
      while (index < lines.length && !/ from '[^']+'$/.test(lines[index] ?? '')) {
        index += 1
      }
      index += 1
      continue
    }
    break
  }
  return lines.slice(index).join('\n').trimEnd()
}

const MIRRORS = [
  { canonical: 'provenance-view.ts', desktop: 'src/shared/alicorn/provenance-view.ts' },
  { canonical: 'provenance-markdown.ts', desktop: 'src/main/alicorn/provenance-markdown.ts' }
] as const

describe('provenance projection parity', () => {
  for (const mirror of MIRRORS) {
    it(`${mirror.canonical} matches the desktop mirror`, () => {
      const canonical = body(readFileSync(resolve(here, mirror.canonical), 'utf8'))
      const desktop = body(readFileSync(resolve(repoRoot, mirror.desktop), 'utf8'))
      expect(canonical.length).toBeGreaterThan(500)
      expect(desktop).toBe(canonical)
    })
  }
})
