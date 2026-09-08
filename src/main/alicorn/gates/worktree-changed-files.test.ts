import { describe, expect, it, vi } from 'vitest'
import { createWorktreeChangedFilesReader } from './worktree-changed-files'

function reader(
  overrides: Partial<Parameters<typeof createWorktreeChangedFilesReader>[0]> = {},
  gitExec = vi.fn().mockResolvedValue('')
) {
  return {
    gitExec,
    read: createWorktreeChangedFilesReader({
      showManagedWorktree: vi.fn().mockResolvedValue({ id: 'wt-1', path: '/repo/wt-1' }),
      resolveBaseRef: vi.fn().mockResolvedValue({ baseRef: 'origin/main', gitOptions: {} }),
      gitExec,
      ...overrides
    })
  }
}

describe('createWorktreeChangedFilesReader', () => {
  it('unions committed, working-tree and untracked changes', async () => {
    const gitExec = vi.fn(async (args: string[]) => {
      if (args.includes('ls-files')) {
        return 'notes/new.md\n'
      }
      if (args.includes('origin/main...HEAD')) {
        return 'src/a.ts\nsrc/b.ts\n'
      }
      return 'src/b.ts\nsrc/c.ts\n'
    })
    const { read } = reader({}, gitExec)

    const files = await read('wt-1')

    expect(files ? [...files].sort() : null).toEqual([
      'notes/new.md',
      'src/a.ts',
      'src/b.ts',
      'src/c.ts'
    ])
  })

  it('diffs against the authored base ref and keeps non-ASCII paths unquoted', async () => {
    const { read, gitExec } = reader({
      resolveBaseRef: vi.fn().mockResolvedValue({ baseRef: 'origin/trunk', gitOptions: {} })
    })
    await read('wt-1')
    const committed = gitExec.mock.calls.find((call) => call[0].includes('origin/trunk...HEAD'))
    expect(committed?.[0]).toEqual([
      '-c',
      'core.quotePath=false',
      'diff',
      '--name-only',
      '--no-renames',
      'origin/trunk...HEAD'
    ])
    expect(committed?.[1]).toBe('/repo/wt-1')
  })

  it('routes through the worktree’s WSL distro when the repo has one', async () => {
    const { read, gitExec } = reader({
      resolveBaseRef: vi
        .fn()
        .mockResolvedValue({ baseRef: 'origin/main', gitOptions: { wslDistro: 'Ubuntu' } })
    })
    await read('wt-1')
    expect(gitExec.mock.calls.every((call) => call[2] === 'Ubuntu')).toBe(true)
  })

  it('refuses to answer for a worktree on a remote execution host', async () => {
    // The execution host owns everything that touches execution; a diff taken here would be of
    // some other machine's filesystem, or of nothing at all.
    const { read, gitExec } = reader({
      showManagedWorktree: vi
        .fn()
        .mockResolvedValue({ id: 'wt-1', path: '/repo/wt-1', hostId: 'ssh-box' })
    })
    await expect(read('wt-1')).resolves.toBeNull()
    expect(gitExec).not.toHaveBeenCalled()
  })

  it('answers null — never an empty list — when git fails', async () => {
    // A folder workspace that is not a repository lands here, and "no diff" must not read as
    // "nothing changed".
    const { read } = reader({}, vi.fn().mockRejectedValue(new Error('not a git repository')))
    await expect(read('wt-1')).resolves.toBeNull()
  })

  it('answers null when the worktree or its base ref cannot be resolved', async () => {
    const gone = reader({ showManagedWorktree: vi.fn().mockRejectedValue(new Error('no such')) })
    await expect(gone.read('wt-1')).resolves.toBeNull()

    const unbased = reader({ resolveBaseRef: vi.fn().mockRejectedValue(new Error('no store')) })
    await expect(unbased.read('wt-1')).resolves.toBeNull()

    const pathless = reader({
      showManagedWorktree: vi.fn().mockResolvedValue({ id: 'wt-1', path: '' })
    })
    await expect(pathless.read('wt-1')).resolves.toBeNull()
  })
})
