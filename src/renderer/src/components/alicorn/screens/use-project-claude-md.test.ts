import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedProjectClaudeMd } from './use-project-claude-md'

function withFs(readFile: () => unknown): { writes: { filePath: string; content: string }[] } {
  const writes: { filePath: string; content: string }[] = []
  ;(globalThis as unknown as { window: unknown }).window = {
    api: {
      fs: {
        readFile: vi.fn(readFile),
        writeFile: vi.fn((args: { filePath: string; content: string }) => {
          writes.push(args)
          return Promise.resolve()
        })
      }
    }
  }
  return { writes }
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window
})

describe('seeding an imported project’s CLAUDE.md', () => {
  it('writes the board description when the repository has none', async () => {
    const fs = withFs(() => Promise.reject(new Error('ENOENT')))
    expect(
      await seedProjectClaudeMd({
        repoPath: '/repos/pay/',
        projectName: 'Payments',
        context: 'Charges, refunds and settlement.'
      })
    ).toBe(true)
    expect(fs.writes).toEqual([
      {
        filePath: '/repos/pay/CLAUDE.md',
        content: '# Payments\n\nCharges, refunds and settlement.\n'
      }
    ])
  })

  // The team's file stays the team's, even when the import has the richer description.
  it('never overwrites an existing file', async () => {
    const fs = withFs(() => Promise.resolve({ content: '# Ours', isBinary: false }))
    expect(
      await seedProjectClaudeMd({
        repoPath: '/repos/pay',
        projectName: 'Payments',
        context: 'Charges, refunds and settlement.'
      })
    ).toBe(false)
    expect(fs.writes).toEqual([])
  })

  it('writes nothing for a board with no description', async () => {
    const fs = withFs(() => Promise.reject(new Error('ENOENT')))
    expect(
      await seedProjectClaudeMd({ repoPath: '/repos/pay', projectName: 'Payments', context: '  ' })
    ).toBe(false)
    expect(fs.writes).toEqual([])
  })
})
