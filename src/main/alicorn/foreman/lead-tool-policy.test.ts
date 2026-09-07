import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { evaluateLeadToolUse, leadToolUseFromPreToolUsePayload } from './lead-tool-policy'

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

  // Why: the agent's cwd is the worktree, so a relative path names implementation just as an
  // absolute one does — resolving it against process.cwd() instead would let every read through.
  it('blocks a relative path, which is relative to the worktree', () => {
    expect(use('Read', 'src/a.ts')?.decision).toBe('block')
    expect(use('Read', './src/a.ts')?.decision).toBe('block')
  })

  // The journal is the lead's own working memory; reading it is the whole design.
  it('allows the journal under .foreman/', () => {
    expect(use('Read', join(WT, '.foreman', 'run_1', 'journal.md'))).toBeNull()
    expect(use('Glob', join(WT, '.foreman'))).toBeNull()
    expect(use('Read', '.foreman/run_1/journal.md')).toBeNull()
  })

  // Why: refusing what cannot be located would block journal reads on any tool shape we have not
  // anticipated, and writes are already refused whether or not they name a path.
  it('allows a read with no path', () => {
    expect(use('Read')).toBeNull()
  })

  it('allows reading outside the worktree', () => {
    expect(use('Read', '/etc/hosts')).toBeNull()
    expect(use('Read', join(WT, '..', 'other', 'a.ts'))).toBeNull()
  })

  it('leaves tools it does not police alone', () => {
    expect(use('Bash', join(WT, 'src/a.ts'))).toBeNull()
    expect(use('Task')).toBeNull()
  })

  // A path that merely starts with the same characters is a different directory.
  it('does not treat a sibling directory as the journal', () => {
    expect(use('Read', join(WT, '.foremanx', 'a.md'))?.decision).toBe('block')
  })

  // Why: the root is not outside the worktree and is not the journal, so it is implementation —
  // and a search rooted there is the whole of it.
  it('blocks the worktree root itself', () => {
    expect(use('Grep', WT)?.decision).toBe('block')
    expect(use('Read', WT)?.decision).toBe('block')
  })
})

describe('leadToolUseFromPreToolUsePayload', () => {
  it('reads the tool and its path', () => {
    expect(
      leadToolUseFromPreToolUsePayload(
        { tool_name: 'Read', tool_input: { file_path: join(WT, 'src/a.ts') } },
        WT
      )
    ).toEqual({ toolName: 'Read', path: join(WT, 'src/a.ts'), worktreePath: WT })
  })

  it.each(['filePath', 'path'])('accepts %s as the path field', (key) => {
    expect(
      leadToolUseFromPreToolUsePayload({ tool_name: 'Read', tool_input: { [key]: '/x/a.ts' } }, WT)
    ).toMatchObject({ path: '/x/a.ts' })
  })

  // Why: Grep and Glob search a tree rather than naming a file, so an absent path is the agent's
  // cwd — the worktree — and treating it as "no path" would allow the one read that matters most.
  it.each(['Grep', 'Glob'])('reads %s with no path as the worktree root', (tool) => {
    const asked = leadToolUseFromPreToolUsePayload({ tool_name: tool, tool_input: {} }, WT)

    expect(asked?.path).toBe('.')
    expect(evaluateLeadToolUse(asked!)?.decision).toBe('block')
  })

  it('leaves a pathless read pathless', () => {
    expect(leadToolUseFromPreToolUsePayload({ tool_name: 'Read', tool_input: {} }, WT)).toEqual({
      toolName: 'Read',
      worktreePath: WT
    })
  })

  it('ignores a payload that names no tool', () => {
    expect(leadToolUseFromPreToolUsePayload({ tool_input: { file_path: '/x' } }, WT)).toBeNull()
    expect(leadToolUseFromPreToolUsePayload({ tool_name: '   ' }, WT)).toBeNull()
  })

  it('survives a tool_input that is not an object', () => {
    expect(leadToolUseFromPreToolUsePayload({ tool_name: 'Read', tool_input: 'nope' }, WT)).toEqual(
      {
        toolName: 'Read',
        worktreePath: WT
      }
    )
  })
})
