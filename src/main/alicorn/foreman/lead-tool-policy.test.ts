import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { evaluateLeadToolUse } from './lead-tool-policy'

const WT = join('/repo', 'wt')

function use(toolName: string, path?: string) {
  return evaluateLeadToolUse({ toolName, path, worktreePath: WT })
}

describe('evaluateLeadToolUse', () => {
  it.each(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])('blocks %s outright', (tool) => {
    expect(use(tool, join(WT, 'src/a.ts'))?.decision).toBe('block')
  })

  it('tells the lead what to do instead of writing', () => {
    expect(use('Write', join(WT, 'src/a.ts'))?.reason).toContain('Dispatch a worker')
  })

  it('blocks a write even with no path', () => {
    expect(use('Edit')?.decision).toBe('block')
  })

  it('blocks reading implementation inside the worktree', () => {
    expect(use('Read', join(WT, 'src/a.ts'))?.decision).toBe('block')
    expect(use('Grep', join(WT, 'src/deep/nested/b.ts'))?.decision).toBe('block')
  })

  // The journal is the lead's own working memory; reading it is the whole design.
  it('allows the journal under .foreman/', () => {
    expect(use('Read', join(WT, '.foreman', 'run_1', 'journal.md'))).toBeNull()
    expect(use('Glob', join(WT, '.foreman'))).toBeNull()
  })

  // Why: refusing what cannot be located would block journal reads on any tool shape we have not
  // anticipated, and writes are already refused at launch.
  it('allows a read with no path', () => {
    expect(use('Read')).toBeNull()
  })

  it('allows reading outside the worktree', () => {
    expect(use('Read', '/etc/hosts')).toBeNull()
  })

  it('leaves tools it does not police alone', () => {
    expect(use('Bash', join(WT, 'src/a.ts'))).toBeNull()
    expect(use('Task')).toBeNull()
  })

  // A path that merely starts with the same characters is a different directory.
  it('does not treat a sibling directory as the journal', () => {
    expect(use('Read', join(WT, '.foremanx', 'a.md'))?.decision).toBe('block')
  })

  it('does not treat the worktree path itself as implementation', () => {
    expect(use('Read', WT)).toBeNull()
  })
})
