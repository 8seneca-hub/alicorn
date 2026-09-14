import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: happy-dom does not reproduce Chromium's display:none focus no-op, so the #9939 regression
// is invisible to behavioral tests. Pin the routing decision at the source level instead.
function paletteSource(fileName: string): string {
  return readFileSync(join(__dirname, '..', fileName), 'utf8')
}

function sourceBetween(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start + startPattern.length)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Cmd+J activation focus routing (#9939)', () => {
  // The palette no longer has a worktree row, so the only activation left on this path is the
  // create flow's typed #N jump, pinned below.
  it('restores the pre-palette element for project targets instead of the first terminal found', () => {
    const handler = sourceBetween(
      paletteSource('use-worktree-jump-palette-selection-actions.ts'),
      'const handleSelectProjectTarget = useCallback',
      'const handleSelectItem = useCallback'
    )

    expect(handler).toContain('focusFallbackSurface(previousFocusElementRef.current)')
    expect(handler).not.toMatch(/focusFallbackSurface\(\)/)
  })

  it('falls back when scoped focus declines for an already-open issue match', () => {
    const handler = paletteSource('worktree-jump-palette-create-worktree.ts')
    const activationCalls =
      handler.match(/const activation = activateAndRevealWorktree\(/g)?.length ?? 0
    // Typed #N jumps to an existing match; pasted URLs stay in the composer
    // so cross-project detection can choose the correct project.
    expect(activationCalls).toBe(1)
    expect(
      handler.match(
        /if \(!queueWorkspaceActivationTerminalFocus\(activeMatch\.id, activation\)\) \{\s*focusFallbackSurface\(\)\s*\}/g
      )?.length
    ).toBe(activationCalls)
  })
})
