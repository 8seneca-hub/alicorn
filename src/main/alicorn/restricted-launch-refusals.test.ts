import { describe, expect, it } from 'vitest'
import {
  restrictedLaunchTerminalReuseError,
  restrictedLaunchWorktreeError
} from './restricted-launch-refusals'

describe('restricted launch refusals', () => {
  it('names the role in the code so a caller can tell the two apart', () => {
    expect(restrictedLaunchWorktreeError('lead').code).toBe('lead_worktree_unsupported')
    expect(restrictedLaunchWorktreeError('qa').code).toBe('qa_worktree_unsupported')
    expect(restrictedLaunchTerminalReuseError('lead').code).toBe('lead_terminal_reuse_unsupported')
    expect(restrictedLaunchTerminalReuseError('qa').code).toBe('qa_terminal_reuse_unsupported')
  })

  it('tells the caller what to do instead', () => {
    expect(restrictedLaunchWorktreeError('qa').message).toContain('existing worktree')
    expect(restrictedLaunchTerminalReuseError('qa').message).toContain('worker start --member')
  })
})
