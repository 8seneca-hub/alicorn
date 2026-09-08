import { describe, expect, it } from 'vitest'
import { bashCommandPaths } from './qa-bash-command-paths'

describe('bashCommandPaths', () => {
  it('finds the path a reader names', () => {
    expect(bashCommandPaths('cat src/impl.ts')).toContain('src/impl.ts')
  })

  it('finds a path behind a pipe, a redirect or a subshell', () => {
    expect(bashCommandPaths('grep -n foo tests/a.ts | head -5 > /tmp/out.txt')).toEqual(
      expect.arrayContaining(['tests/a.ts', '/tmp/out.txt'])
    )
    expect(bashCommandPaths('echo $(cat src/impl.ts)')).toContain('src/impl.ts')
  })

  it('finds a tree walk that names no reader at its head', () => {
    expect(bashCommandPaths('find . -name "*.ts" -exec cat {} +')).toContain('.')
  })

  it('keeps the value of a --flag=path', () => {
    expect(bashCommandPaths('rg --file=src/impl.ts pattern')).toContain('src/impl.ts')
  })

  it('ignores flags and URLs', () => {
    expect(bashCommandPaths('curl -sS https://example.com/a.json')).toEqual([])
  })

  // `cd <worktree> && …` is how most agents open a command, and changing directory reads nothing.
  it('ignores the directory a command changes into', () => {
    expect(bashCommandPaths('cd /repo/wt && pnpm test')).toEqual([])
    expect(bashCommandPaths('cd /repo/wt && cat src/impl.ts')).toEqual(['src/impl.ts'])
  })

  it('finds nothing in a command that names no path', () => {
    expect(bashCommandPaths('pnpm test')).toEqual([])
  })
})
