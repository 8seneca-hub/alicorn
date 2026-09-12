import { describe, expect, it } from 'vitest'
import { resolveLeftTitlebarChromeLayout } from './titlebar-left-chrome'

describe('resolveLeftTitlebarChromeLayout', () => {
  it('mounts in normal workspace chrome, floating over the content', () => {
    expect(
      resolveLeftTitlebarChromeLayout({
        workspaceChromeActive: true,
        creationLayoutActive: false
      })
    ).toEqual({ shouldMount: true, isFloating: true })
  })

  it('preserves the left titlebar chrome during visible worktree creation', () => {
    expect(
      resolveLeftTitlebarChromeLayout({
        workspaceChromeActive: false,
        creationLayoutActive: true
      })
    ).toEqual({ shouldMount: true, isFloating: true })
  })

  it('stays unmounted on full-width titlebar pages', () => {
    expect(
      resolveLeftTitlebarChromeLayout({
        workspaceChromeActive: false,
        creationLayoutActive: false
      })
    ).toEqual({ shouldMount: false, isFloating: false })
  })
})
