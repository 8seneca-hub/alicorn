import { describe, expect, it } from 'vitest'
import { findFirstMainAreaTerminalTabId } from './main-area-terminal-tab'
import type { TerminalTab } from '../../../shared/terminal-tab-types'

function tab(id: string, surface?: 'sidebar'): TerminalTab {
  return { id, ...(surface ? { surface } : {}) } as TerminalTab
}

describe('findFirstMainAreaTerminalTabId', () => {
  // Why this case and not just the happy path: index 0 is what the four callers used before, so a
  // test whose sidebar terminal sorts second passes with the bug still present.
  it('skips a surface-owned terminal that sorts first', () => {
    expect(findFirstMainAreaTerminalTabId([tab('sidebar_1', 'sidebar'), tab('main_1')])).toBe(
      'main_1'
    )
  })

  it('returns the first main-area terminal when it sorts first', () => {
    expect(findFirstMainAreaTerminalTabId([tab('main_1'), tab('sidebar_1', 'sidebar')])).toBe(
      'main_1'
    )
  })

  it('returns undefined when every terminal is surface-owned', () => {
    expect(findFirstMainAreaTerminalTabId([tab('sidebar_1', 'sidebar')])).toBeUndefined()
  })

  it('returns undefined for an absent or empty worktree entry', () => {
    expect(findFirstMainAreaTerminalTabId(undefined)).toBeUndefined()
    expect(findFirstMainAreaTerminalTabId([])).toBeUndefined()
  })
})
